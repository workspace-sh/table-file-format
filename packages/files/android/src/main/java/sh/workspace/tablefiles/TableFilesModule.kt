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
// - the new bytes are kept beside the copy (`.pending`) until the document
//   has them, synced; a write that fails, or is cut short, leaves them
//   there, and holding the document again (the next launch) writes them to
//   it before anything is read back, so no edit is lost to a failed write;
// - the document's own size and time are its stamp (documentStamp), so a
//   change made to it elsewhere is seen, and not written over;
// - a copy whose document was let go (release) can't be written: that
//   says so rather than saving nowhere.

package sh.workspace.tablefiles

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import kotlinx.coroutines.launch

private const val PICK_DOCUMENT = 7311
private const val GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

class TableFilesException(message: String) : CodedException("ERR_TABLE_FILES", message, null)

class TableFilesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var picking: Promise? = null

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
      } catch (e: Exception) {
        mapOf("error" to (e.message ?: e.toString()), "bookmark" to bookmark)
      }
    }

    /// The document's own size and time, for a copy held for one; null for any other path.
    AsyncFunction("documentStamp") { path: String ->
      val uri = synchronized(documents) { documents[path] } ?: return@AsyncFunction null
      stampOf(uri)
    }

    /// Replace the document held at `path` with `bytes` (written and synced first), then its copy.
    AsyncFunction("writeCoordinated") { path: String, bytes: Uint8Array ->
      val data = ByteArray(bytes.byteLength)
      bytes.read(data, 0, bytes.byteLength)
      val copy = File(path)
      val uri = synchronized(documents) { documents[path] }
      if (uri == null) {
        // A held copy whose document was let go: saving it would save nowhere.
        if (isHeld(copy)) throw TableFilesException("${copy.name} isn't open any more, so it wasn't saved.")
        replace(copy, data)
        return@AsyncFunction
      }
      val pending = pendingOf(copy)
      replace(pending, data)
      writeDocument(uri, data)
      if (!pending.renameTo(copy)) throw TableFilesException("${copy.name} was saved, but its copy here couldn't be.")
    }

    /// Stop holding the document whose copy is at `path`, and give back the grant to it.
    Function("release") { path: String ->
      val uri = synchronized(documents) { documents.remove(path) } ?: return@Function
      for (flags in listOf(GRANT, Intent.FLAG_GRANT_READ_URI_PERMISSION)) {
        try {
          context.contentResolver.releasePersistableUriPermission(uri, flags)
          return@Function
        } catch (_: SecurityException) {
          // Not held with these: try read alone.
        }
      }
    }

    /// Move the file at `from` to `to` (paths, not URLs), replacing what is there, in one step.
    Function("rename") { from: String, to: String ->
      if (!File(from).renameTo(File(to))) throw TableFilesException("Couldn't move $from to $to.")
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

  /// The document held: first given a write it never finished, then copied, as it is now, into the app's files.
  private fun hold(uri: Uri): Map<String, Any> {
    val name = nameOf(uri)
    val folder = File(context.filesDir, "held/${digest(uri.toString())}")
    folder.mkdirs()
    val copy = File(folder, name)
    val pending = pendingOf(copy)
    if (pending.exists()) {
      // Edits the document didn't get last time: it gets them now, before it's read.
      writeDocument(uri, pending.readBytes())
      pending.delete()
    }
    val input = context.contentResolver.openInputStream(uri) ?: throw TableFilesException("$name can't be read.")
    val staged = File(folder, ".$name.reading")
    input.use { from -> staged.outputStream().use { to -> from.copyTo(to) } }
    if (!staged.renameTo(copy)) throw TableFilesException("$name couldn't be held.")
    synchronized(documents) { documents[copy.path] = uri }
    return mapOf(
      "uri" to Uri.fromFile(copy).toString(),
      "path" to copy.path,
      "name" to name,
      "directory" to false,
      "bookmark" to uri.toString(),
    )
  }

  /// All of `data` into the document, synced to its storage before this returns.
  private fun writeDocument(uri: Uri, data: ByteArray) {
    val fd = context.contentResolver.openFileDescriptor(uri, "wt") ?: throw TableFilesException("The document can't be written.")
    fd.use {
      FileOutputStream(it.fileDescriptor).use { out ->
        out.write(data)
        out.flush()
        out.fd.sync()
      }
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
