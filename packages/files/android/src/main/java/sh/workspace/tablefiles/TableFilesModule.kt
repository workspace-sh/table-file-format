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
// own files, refreshed from the document each time it's held, and each
// write to the copy (writeCoordinated) is written through to the document,
// so it's edited where it is. The bookmark is the document's URI.

package sh.workspace.tablefiles

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.io.File
import java.security.MessageDigest

private const val PICK_DOCUMENT = 7311

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

    /// Ask for a document in the system's picker. Resolves with it held (a copy, written through), or null.
    AsyncFunction("pickDocument") { _: List<String>, promise: Promise ->
      if (picking != null) throw TableFilesException("A document is already being chosen.")
      picking = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        // A .table has no type Android knows: every file is offered, and what can't be read says so.
        type = "*/*"
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      appContext.throwingActivity.startActivityForResult(intent, PICK_DOCUMENT)
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
      try {
        keep(uri)
        promise.resolve(hold(uri))
      } catch (e: Exception) {
        promise.reject(TableFilesException(e.message ?: e.toString()))
      }
    }

    /// A file the app was given by path, held as it is.
    Function("holdDocument") { path: String -> heldFile(File(path)) }

    /// A document kept from before (its bookmark), held again; null when it's gone or no longer granted.
    Function("resolveBookmark") { bookmark: String ->
      val uri = Uri.parse(bookmark)
      if (uri.scheme == "file") {
        val file = File(uri.path ?: "")
        if (file.exists()) heldFile(file) else null
      } else {
        try {
          hold(uri)
        } catch (_: Exception) {
          null
        }
      }
    }

    /// Replace the file at `path` with `bytes` in one step, and the document it holds, if any.
    AsyncFunction("writeCoordinated") { path: String, bytes: Uint8Array ->
      val data = ByteArray(bytes.byteLength)
      bytes.read(data, 0, bytes.byteLength)
      replace(File(path), data)
      val uri = synchronized(documents) { documents[path] }
      if (uri != null) {
        val out = context.contentResolver.openOutputStream(uri, "wt") ?: throw TableFilesException("The document can't be written.")
        out.use { it.write(data) }
      }
    }

    /// Stop holding the document whose copy is at `path`. Its grant stays, so it opens again next launch.
    Function("release") { path: String ->
      synchronized(documents) { documents.remove(path) }
      Unit
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
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    } catch (_: SecurityException) {
      // Read only: it opens, and saving it says why it can't.
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }

  /// The document copied, as it is now, into the app's files, and held there.
  private fun hold(uri: Uri): Map<String, Any> {
    val name = nameOf(uri)
    val folder = File(context.filesDir, "held/${digest(uri.toString())}")
    folder.mkdirs()
    val copy = File(folder, name)
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

  private fun heldFile(file: File): Map<String, Any> = mapOf(
    "uri" to Uri.fromFile(file).toString(),
    "path" to file.path,
    "name" to file.name,
    "directory" to file.isDirectory,
    "bookmark" to Uri.fromFile(file).toString(),
  )

  private fun nameOf(uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val name = cursor.getString(0)
        if (!name.isNullOrBlank()) return name.replace('/', '_')
      }
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
  }

  private fun replace(file: File, data: ByteArray) {
    file.parentFile?.mkdirs()
    val staged = File(file.parentFile, ".${file.name}.writing")
    staged.writeBytes(data)
    if (!staged.renameTo(file)) throw TableFilesException("${file.name} couldn't be saved.")
  }

  private fun digest(text: String): String =
    MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
}
