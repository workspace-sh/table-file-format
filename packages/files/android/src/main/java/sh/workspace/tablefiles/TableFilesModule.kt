// Replacing a file in one step, and documents opened where they are, on
// Android (ios/TableFilesModule.swift is Apple's).
//
// Core's writer saves a file by staging it beside its target and renaming
// it over (TableFs.rename): rename(2), which java.io.File.renameTo is on
// one file system, replaces the target with no moment where neither is
// there.
//
// A document picked in the system's picker is a content URI the app is
// granted for good (a persisted permission), not a path. The app reads and
// writes tables by path, so the document is held as a copy in the app's
// own files (held/<hash>/<name>), and each write to the copy
// (writeCoordinated) goes to the document first, then to the copy:
//
// - the new bytes are kept beside the copy (`.pending`), synced, until the
//   document has them; a write that fails or is cut short leaves them there.
//   Holding the document again finishes it when the document is as that
//   write left it (still the copy, or a beginning of the new bytes); when
//   it was changed elsewhere, it's held as it is and the edits are kept
//   apart (`.unsaved`), to be saved as a copy (keepEditsAsCopy);
// - a document granted for reading only is never written, and nothing waits
//   to be written to it;
// - the document's own size and time are its stamp (documentStamp), so a
//   change made to it elsewhere is seen, and not written over;
// - a copy whose document was let go (release) can't be written: that says
//   so rather than saving nowhere. One with edits its document never got
//   keeps its grant until they're settled.

package sh.workspace.tablefiles

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.File
import java.io.FileOutputStream
import java.io.SyncFailedException
import java.security.MessageDigest
import kotlinx.coroutines.launch

private const val PICK_DOCUMENT = 7311
private const val SAVE_COPY = 7312
// What the module does with documents, at debug level, in release builds too: `adb logcat -s TableFiles`.
private const val TAG = "TableFiles"
private const val GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

class TableFilesException(message: String) : CodedException("ERR_TABLE_FILES", message, null)

class TableFilesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var picking: Promise? = null
  // Keeping edits as a copy: where they are, and who's told.
  private var saving: Pair<File, Promise>? = null

  // Each held copy's document, by the copy's path.
  private val documents = mutableMapOf<String, Uri>()

  override fun definition() = ModuleDefinition {
    Name("TableFiles")

    // Shaking to undo is iOS's; Android has no such setting.
    Events("onShake")
    Function("shakeToUndoEnabled") { false }
    Function("requestOrientation") { _: String -> }

    /// Ask for a document in the system's picker. Resolves with it held, or null.
    AsyncFunction("pickDocument") { _: List<String>, promise: Promise ->
      if (picking != null) throw TableFilesException("A document is already being chosen.")
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        // A .table has no type Android knows: every file is offered, and what can't be read says so.
        type = "*/*"
        addFlags(GRANT or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      picking = promise
      try {
        appContext.throwingActivity.startActivityForResult(intent, PICK_DOCUMENT)
      } catch (e: Exception) {
        picking = null
        throw e
      }
    }

    OnActivityResult { _, (requestCode, resultCode, intent) ->
      if (requestCode == SAVE_COPY) {
        val (unsaved, promise) = saving ?: return@OnActivityResult
        saving = null
        val target = intent?.data
        if (resultCode != Activity.RESULT_OK || target == null) {
          promise.resolve(false)
          return@OnActivityResult
        }
        appContext.backgroundCoroutineScope.launch {
          try {
            writeDocument(target, unsaved.readBytes())
            unsaved.delete()
            Log.d(TAG, "keepEditsAsCopy: written to $target")
            promise.resolve(true)
          } catch (e: Exception) {
            promise.reject(TableFilesException(e.message ?: e.toString()))
          }
        }
        return@OnActivityResult
      }
      if (requestCode != PICK_DOCUMENT) return@OnActivityResult
      val promise = picking ?: return@OnActivityResult
      picking = null
      val uri = intent?.data
      if (resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      // The copy is made off the main thread: a large file takes a while.
      appContext.backgroundCoroutineScope.launch {
        try {
          keep(uri)
          promise.resolve(hold(uri))
        } catch (e: Exception) {
          promise.reject(TableFilesException(e.message ?: e.toString()))
        }
      }
    }

    /// A file the app was given by path, held as it is.
    Function("holdDocument") { path: String -> heldFile(File(path)) }

    /// A document kept from before (its bookmark), held again, off the main thread, as it's copied.
    /// Null when it's gone; `{ error }` when it's there but can't be held (its grant taken away).
    AsyncFunction("resolveBookmark") { bookmark: String ->
      val uri = Uri.parse(bookmark)
      if (uri.scheme == "file") {
        val file = File(uri.path ?: "")
        return@AsyncFunction if (file.exists()) heldFile(file) else null
      }
      val granted = context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
      if (!granted) {
        return@AsyncFunction mapOf("error" to "This app may no longer open it. Open it again to give that back.", "bookmark" to bookmark)
      }
      try {
        hold(uri)
      } catch (_: java.io.FileNotFoundException) {
        // The provider's own message names its paths: said in words instead.
        mapOf("error" to "It isn't there any more. It may have been moved, renamed or deleted.", "bookmark" to bookmark)
      } catch (e: Exception) {
        mapOf("error" to (e.message ?: e.toString()), "bookmark" to bookmark)
      }
    }

    /// The document's own size and time, for a copy held for one; null for any other path.
    AsyncFunction("documentStamp") { path: String ->
      val uri = synchronized(documents) { documents[path] } ?: return@AsyncFunction null
      stampOf(uri).also { Log.d(TAG, "documentStamp: $path is $it") }
    }

    /// A line in the log (TableFiles), from the app's own steps around these: what was packed, and why not.
    Function("log") { message: String -> Log.d(TAG, message) }

    /// Give back every grant kept but for these bookmarks (the documents open), and drop their copies:
    /// what a pick that couldn't be read, or a close the app didn't live to finish, left behind.
    AsyncFunction("releaseAllBut") { keep: List<String> ->
      val kept = keep.toSet()
      for (permission in context.contentResolver.persistedUriPermissions) {
        val uri = permission.uri
        if (uri.toString() in kept) continue
        val folder = File(context.filesDir, "held/${digest(uri.toString())}")
        // Never a document with edits it never got: its grant and its copy wait for them.
        if (folder.listFiles()?.any { it.name.endsWith(".pending") || it.name.endsWith(".unsaved") } == true) continue
        Log.d(TAG, "releaseAllBut: giving back $uri")
        giveBack(uri)
        folder.deleteRecursively()
      }
    }

    /// Replace the document held at `path` with `bytes` (written and synced first), then its copy.
    AsyncFunction("writeCoordinated") { path: String, bytes: Uint8Array ->
      val data = ByteArray(bytes.byteLength)
      bytes.read(data, 0, bytes.byteLength)
      val copy = File(path)
      val uri = synchronized(documents) { documents[path] }
      Log.d(TAG, "writeCoordinated: ${data.size} bytes to $path, document ${uri ?: "none"}")
      if (uri == null) {
        // A held copy whose document was let go: saving it would save nowhere.
        if (isHeld(copy)) throw TableFilesException("${copy.name} isn't open any more, so it wasn't saved.")
        replace(copy, data)
        return@AsyncFunction
      }
      // Granted for reading only: never written, and nothing waits to be.
      if (!canWrite(uri)) throw TableFilesException("${copy.name} can be read here but not changed, so it wasn't saved. Open a copy to edit.")
      val pending = pendingOf(copy)
      // The bytes wait beside the copy, synced and in place, before the document is touched.
      replace(pending, data)
      syncFolder(copy.parentFile)
      writeDocument(uri, data)
      Log.d(TAG, "writeCoordinated: $uri now ${stampOf(uri)}")
      if (!pending.renameTo(copy)) throw TableFilesException("${copy.name} was saved, but its copy here couldn't be.")
      syncFolder(copy.parentFile)
    }

    /// True when it's kept: edits its document never got wait beside the copy, so the grant (and the
    /// copy) stay until they're settled (settle, keepEditsAsCopy).
    Function("release") { path: String ->
      val uri = synchronized(documents) { documents.remove(path) } ?: return@Function false
      val copy = File(path)
      if (waits(copy)) {
        Log.d(TAG, "release: $uri kept, with edits it never got")
        return@Function true
      }
      Log.d(TAG, "release: $uri")
      giveBack(uri)
      copy.parentFile?.deleteRecursively()
      false
    }

    /// Edits kept apart from a document changed elsewhere (`.unsaved`), saved as a new file the
    /// person names in the system's picker. True when saved; false when the picker was left.
    AsyncFunction("keepEditsAsCopy") { path: String, promise: Promise ->
      val copy = File(path)
      val unsaved = unsavedOf(copy)
      if (!unsaved.exists()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      if (saving != null) throw TableFilesException("A copy is already being saved.")
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_TITLE, copy.name.replace(Regex("\\.table$"), "") + " (my edits).table")
      }
      saving = unsaved to promise
      try {
        appContext.throwingActivity.startActivityForResult(intent, SAVE_COPY)
      } catch (e: Exception) {
        saving = null
        throw e
      }
    }

    /// A document closed with edits it never got, held again to finish them, then let go. True when
    /// settled (its grant given back); false while they still wait.
    AsyncFunction("settle") { bookmark: String ->
      val uri = Uri.parse(bookmark)
      val held = try {
        hold(uri)
      } catch (e: Exception) {
        Log.d(TAG, "settle: $uri still waits (${e.message})")
        return@AsyncFunction false
      }
      val copy = File(held["path"] as String)
      synchronized(documents) { documents.remove(copy.path) }
      if (waits(copy)) return@AsyncFunction false
      giveBack(uri)
      copy.parentFile?.deleteRecursively()
      true
    }

    /// Move the file at `from` to `to` (paths, not URLs), replacing what is there, in one step.
    Function("rename") { from: String, to: String ->
      if (!File(from).renameTo(File(to))) throw TableFilesException("Couldn't move $from to $to.")
    }
  }

  private fun giveBack(uri: Uri) {
    for (flags in listOf(GRANT, Intent.FLAG_GRANT_READ_URI_PERMISSION)) {
      try {
        context.contentResolver.releasePersistableUriPermission(uri, flags)
        return
      } catch (_: SecurityException) {
        // Not held with these: try read alone.
      }
    }
  }

  /// The grant to read (and, where given, write) the document, kept across launches.
  private fun keep(uri: Uri) {
    val resolver = context.contentResolver
    try {
      resolver.takePersistableUriPermission(uri, GRANT)
    } catch (_: SecurityException) {
      // Read only: it opens, and saving it says why it can't.
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }

  private fun isHeld(file: File): Boolean =
    file.canonicalPath.startsWith(File(context.filesDir, "held").canonicalPath + File.separator)

  private fun pendingOf(copy: File): File = File(copy.parentFile, ".${copy.name}.pending")

  /// A folder's entries (a rename in it) made durable, where the system allows it.
  private fun syncFolder(folder: File?) {
    if (folder == null) return
    try {
      val fd = Os.open(folder.path, OsConstants.O_RDONLY, 0)
      try {
        Os.fsync(fd)
      } finally {
        Os.close(fd)
      }
    } catch (_: Exception) {
      // Not every file system lets a folder be synced.
    }
  }

  /// The document held: a write it never finished settled first, then copied, as it is now, into the
  /// app's files. Its stamp is read before its bytes; `unsavedEdits` when edits were kept apart.
  private fun hold(uri: Uri): Map<String, Any?> {
    val name = nameOf(uri)
    val folder = File(context.filesDir, "held/${digest(uri.toString())}")
    folder.mkdirs()
    val copy = File(folder, name)
    val pending = pendingOf(copy)
    if (pending.exists()) settlePending(uri, copy, pending)
    val stamp = stampOf(uri)
    val input = context.contentResolver.openInputStream(uri) ?: throw TableFilesException("$name can't be read.")
    val staged = File(folder, ".$name.reading")
    input.use { from -> staged.outputStream().use { to -> from.copyTo(to) } }
    if (!staged.renameTo(copy)) throw TableFilesException("$name couldn't be held.")
    synchronized(documents) { documents[copy.path] = uri }
    Log.d(TAG, "hold: $uri as ${copy.path} (${copy.length()} bytes, $stamp)")
    return mapOf(
      "uri" to Uri.fromFile(copy).toString(),
      "path" to copy.path,
      "name" to name,
      "directory" to false,
      "bookmark" to uri.toString(),
      "stamp" to stamp,
      "unsavedEdits" to unsavedOf(copy).exists(),
    )
  }

  /// A write the document never finished: finished when the document is as that write left it (the
  /// copy as it was, or a beginning of the new bytes, from a write cut short); otherwise (changed
  /// elsewhere, or not to be written) the edits are kept apart, and the document is read as it is.
  private fun settlePending(uri: Uri, copy: File, pending: File) {
    val edits = pending.readBytes()
    val now = try {
      context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
    } catch (_: Exception) {
      null
    }
    val was = if (copy.exists()) copy.readBytes() else null
    val ours = now != null && ((was != null && now.contentEquals(was)) || (now.size <= edits.size && edits.copyOfRange(0, now.size).contentEquals(now)))
    if (ours && canWrite(uri)) {
      try {
        Log.d(TAG, "hold: finishing a write of ${edits.size} bytes to $uri")
        writeDocument(uri, edits)
        if (pending.renameTo(copy)) syncFolder(copy.parentFile)
        return
      } catch (e: Exception) {
        Log.d(TAG, "hold: $uri couldn't be finished (${e.message}); its edits kept apart")
      }
    } else {
      Log.d(TAG, "hold: $uri changed elsewhere, or read only; its edits kept apart")
    }
    // Never in the way of reading the document: kept apart, offered as a copy.
    val unsaved = unsavedOf(copy)
    if (unsaved.exists()) unsaved.delete()
    pending.renameTo(unsaved)
    syncFolder(copy.parentFile)
  }

  private fun unsavedOf(copy: File): File = File(copy.parentFile, ".${copy.name}.unsaved")

  /// Whether edits wait beside the copy that its document never got.
  private fun waits(copy: File): Boolean = pendingOf(copy).exists() || unsavedOf(copy).exists()

  private fun canWrite(uri: Uri): Boolean =
    context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isWritePermission }

  /// All of `data` into the document, synced to its storage before this returns.
  private fun writeDocument(uri: Uri, data: ByteArray) {
    val fd = context.contentResolver.openFileDescriptor(uri, "wt") ?: throw TableFilesException("The document can't be written.")
    fd.use {
      FileOutputStream(it.fileDescriptor).use { out ->
        out.write(data)
        out.flush()
        try {
          out.fd.sync()
        } catch (_: SyncFailedException) {
          // A provider's pipe can't be synced: what it took is checked instead, where it can say.
          // (statSize is -1 for a pipe, which says nothing of its length.)
          val size = it.statSize
          if (size >= 0 && size != data.size.toLong()) throw TableFilesException("The document took $size of ${data.size} bytes.")
        }
      }
      // What the provider at the other end says of it (a pipe's reader that failed).
      it.checkError()
    }
  }

  private fun stampOf(uri: Uri): String? = try {
    val columns = arrayOf(OpenableColumns.SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
    context.contentResolver.query(uri, columns, null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) {
        null
      } else {
        val size = if (cursor.isNull(0)) "" else cursor.getLong(0).toString()
        val time = if (cursor.columnCount < 2 || cursor.isNull(1)) "" else cursor.getLong(1).toString()
        "$size:$time"
      }
    }
  } catch (_: Exception) {
    null
  }

  private fun heldFile(file: File): Map<String, Any> = mapOf(
    "uri" to Uri.fromFile(file).toString(),
    "path" to file.path,
    "name" to file.name,
    "directory" to file.isDirectory,
    "bookmark" to Uri.fromFile(file).toString(),
  )

  private fun nameOf(uri: Uri): String {
    try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val name = cursor.getString(0)
          if (!name.isNullOrBlank()) return name.replace('/', '_')
        }
      }
    } catch (_: Exception) {
      // Fall back to the URI's own last part.
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
  }

  private fun replace(file: File, data: ByteArray) {
    file.parentFile?.mkdirs()
    val staged = File(file.parentFile, ".${file.name}.writing")
    FileOutputStream(staged).use { out ->
      out.write(data)
      out.fd.sync()
    }
    if (!staged.renameTo(file)) throw TableFilesException("${file.name} couldn't be saved.")
  }

  private fun digest(text: String): String =
    MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
}
