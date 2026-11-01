// Replacing a file in one step. Core's writer saves a file by staging it
// beside its target and renaming it over (TableFs.rename): a reader, or
// the app started again after being ended mid-save, sees the old file or
// the new one, never neither. The platform's file manager won't move a
// file onto one that exists, and removing the target first leaves a
// moment with no file at all; rename(2) has no such moment.
//
// And documents opened where they are (SPEC section 13, D49): a .table
// folder or single file chosen in the system's picker, held open by its
// security scope and kept for the next launch as a bookmark; a single file
// saved back by a coordinated write, the way the system asks of a file the
// app was only given access to.

import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

public class TableFilesModule: Module {
  private var shakes: NSObjectProtocol?
  private var picking: TableDocumentPicking?

  public func definition() -> ModuleDefinition {
    Name("TableFiles")

    /// The phone was shaken, and nothing that edits text (which has its own Undo) took the shake.
    Events("onShake")

    // Shakes are watched for only while something listens (onShakeToUndo):
    // an app that never asks never has its window's motionEnded changed.
    OnStartObserving {
      TableShake.start()
      guard self.shakes == nil else { return }
      self.shakes = NotificationCenter.default.addObserver(forName: TableShake.shaken, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onShake", [:])
      }
    }

    OnStopObserving {
      if let shakes = self.shakes { NotificationCenter.default.removeObserver(shakes) }
      self.shakes = nil
    }

    /// Development: turn the screen to "landscape" or "portrait", as turning the phone does, so a
    /// rotation can be recorded in the Simulator, which has no window to turn here.
    Function("requestOrientation") { (to: String) in
      DispatchQueue.main.async {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let mask: UIInterfaceOrientationMask = to == "landscape" ? .landscapeRight : .portrait
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
          NSLog("[TableFiles] requestOrientation(%@): %@", to, error.localizedDescription)
        }
      }
    }

    /// Whether the person wants shaking to undo (Settings › Accessibility › Touch › Shake to Undo).
    Function("shakeToUndoEnabled") { () -> Bool in
      UIAccessibility.isShakeToUndoEnabled
    }

    /// Ask for a document where it is, not a copy: of one of `types` (type identifiers, or
    /// filename extensions). Resolves with it held open (TableDocuments.held), or null.
    AsyncFunction("pickDocument") { (types: [String], promise: Promise) in
      let contentTypes = types.compactMap { UTType($0) ?? UTType(filenameExtension: $0) }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_TABLE_FILES_PICK", "There's nothing on screen to show the picker over.")
        return
      }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: contentTypes, asCopy: false)
      let picking = TableDocumentPicking { url in
        self.picking = nil
        promise.resolve(url.map { TableDocuments.held($0) } ?? nil)
      }
      self.picking = picking
      picker.delegate = picking
      picker.presentationController?.delegate = picking
      presenter.present(picker, animated: true)
    }.runOnQueue(.main)

    /// A document the app was given some other way (the system opening it in the app), held
    /// open as a picked one is.
    Function("holdDocument") { (path: String) -> [String: Any] in
      TableDocuments.held(URL(fileURLWithPath: path))
    }

    /// A document kept from before (`pickDocument`'s bookmark), held open again; null when it's gone.
    Function("resolveBookmark") { (bookmark: String) -> [String: Any]? in
      TableDocuments.resolve(bookmark)
    }

    /// Replace the file at `path` with `bytes`, as one coordinated write.
    AsyncFunction("writeCoordinated") { (path: String, bytes: Data) in
      try TableDocuments.write(bytes, to: path)
    }

    /// Stop holding the document at `path` open.
    Function("release") { (path: String) in
      TableDocuments.release(path)
    }

    /// Move the file at `from` to `to` (file-system paths, not URLs), replacing what is there.
    Function("rename") { (from: String, to: String) in
      if Darwin.rename(from, to) != 0 {
        throw Exception(name: "ERR_TABLE_FILES_RENAME", description: String(cString: strerror(errno)))
      }
    }
  }
}

// A shake comes to the window when no first responder takes it first (a text
// field does, for its own Undo Typing). The window's motionEnded(_:with:)
// becomes one that tells the app and then calls what was there before, under
// motionEnded's own name: UIResponder's passes the call up the responder
// chain by that name, so it must never be reached under another.
enum TableShake {
  static let shaken = Notification.Name("TableShakeShaken")
  private static var started = false
  private static var before: IMP?

  private typealias MotionEnded = @convention(c) (AnyObject, Selector, UIEvent.EventSubtype, UIEvent?) -> Void

  static func start() {
    guard !started else { return }
    started = true
    let selector = #selector(UIResponder.motionEnded(_:with:))
    guard let method = class_getInstanceMethod(UIWindow.self, selector) else { return }
    // What a window does now: its own, or the UIResponder one it inherits.
    before = method_getImplementation(method)
    let block: @convention(block) (UIWindow, UIEvent.EventSubtype, UIEvent?) -> Void = { window, motion, event in
      if motion == .motionShake {
        NotificationCenter.default.post(name: shaken, object: nil)
      }
      if let before {
        unsafeBitCast(before, to: MotionEnded.self)(window, selector, motion, event)
      }
    }
    let implementation = imp_implementationWithBlock(block)
    // Added to UIWindow itself, so UIResponder's own stays as it is for every
    // other responder; where UIWindow already has one, that one is replaced.
    if !class_addMethod(UIWindow.self, selector, implementation, method_getTypeEncoding(method)) {
      before = method_setImplementation(method, implementation)
    }
  }
}

// The documents held open by their security scope, by path.
enum TableDocuments {
  private static var open: [String: URL] = [:]
  private static let lock = NSLock()

  /// `url` held open, as JavaScript gets it: where it is, its name, whether it is a folder, and a bookmark for next time.
  static func held(_ url: URL) -> [String: Any] {
    if url.startAccessingSecurityScopedResource() {
      lock.lock(); open[url.path] = url; lock.unlock()
    }
    let directory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    let bookmark = (try? url.bookmarkData())?.base64EncodedString() ?? ""
    return ["uri": url.absoluteString, "path": url.path, "name": url.lastPathComponent, "directory": directory, "bookmark": bookmark]
  }

  static func resolve(_ bookmark: String) -> [String: Any]? {
    guard let data = Data(base64Encoded: bookmark) else { return nil }
    var stale = false
    guard let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale) else { return nil }
    var held = held(url)
    // A bookmark gone stale (the document moved) still found it; the new one is kept from here on.
    if !stale { held["bookmark"] = bookmark }
    return held
  }

  static func write(_ bytes: Data, to path: String) throws {
    lock.lock(); let url = open[path] ?? URL(fileURLWithPath: path); lock.unlock()
    var coordination: NSError?
    var failure: Error?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordination) { target in
      do {
        try bytes.write(to: target, options: .atomic)
      } catch {
        // Where a file stands alone (its folder isn't the app's to write in), in place.
        do { try bytes.write(to: target) } catch { failure = error }
      }
    }
    if let error = coordination ?? failure {
      throw Exception(name: "ERR_TABLE_FILES_WRITE", description: error.localizedDescription)
    }
  }

  static func release(_ path: String) {
    lock.lock(); let url = open.removeValue(forKey: path); lock.unlock()
    url?.stopAccessingSecurityScopedResource()
  }
}

// The picker's answer: the document chosen, or nil when it was cancelled or dismissed.
final class TableDocumentPicking: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private var done: ((URL?) -> Void)?

  init(done: @escaping (URL?) -> Void) {
    self.done = done
  }

  private func finish(_ url: URL?) {
    done?(url)
    done = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(nil)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(nil)
  }
}
