// Replacing a file in one step. Core's writer saves a file by staging it
// beside its target and renaming it over (TableFs.rename): a reader, or
// the app started again after being ended mid-save, sees the old file or
// the new one, never neither. The platform's file manager won't move a
// file onto one that exists, and removing the target first leaves a
// moment with no file at all; rename(2) has no such moment.

import ExpoModulesCore
import Foundation
import UIKit

public class TableFilesModule: Module {
  private var shakes: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("TableFiles")

    /// The phone was shaken, and nothing that edits text (which has its own Undo) took the shake.
    Events("onShake")

    OnCreate {
      TableShake.start()
      self.shakes = NotificationCenter.default.addObserver(forName: TableShake.shaken, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onShake", [:])
      }
    }

    OnDestroy {
      if let shakes = self.shakes { NotificationCenter.default.removeObserver(shakes) }
    }

    /// Whether the person wants shaking to undo (Settings › Accessibility › Touch › Shake to Undo).
    Function("shakeToUndoEnabled") { () -> Bool in
      UIAccessibility.isShakeToUndoEnabled
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
// field does, for its own Undo Typing). UIWindow doesn't implement
// motionEnded(_:with:) itself, so the window gets one that tells the app and
// then does what was there before (UIResponder's, or another hook's).
enum TableShake {
  static let shaken = Notification.Name("TableShakeShaken")
  private static var started = false

  static func start() {
    guard !started else { return }
    started = true
    let window: AnyClass = UIWindow.self
    let original = #selector(UIResponder.motionEnded(_:with:))
    let replacement = #selector(UIWindow.table_motionEnded(_:with:))
    guard let originalMethod = class_getInstanceMethod(window, original),
          let replacementMethod = class_getInstanceMethod(window, replacement) else { return }
    // Added to UIWindow itself first, so UIResponder's own is never swapped for every responder.
    if class_addMethod(window, original, method_getImplementation(replacementMethod), method_getTypeEncoding(replacementMethod)) {
      class_replaceMethod(window, replacement, method_getImplementation(originalMethod), method_getTypeEncoding(originalMethod))
    } else {
      method_exchangeImplementations(originalMethod, replacementMethod)
    }
  }
}

extension UIWindow {
  @objc func table_motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    if motion == .motionShake {
      NotificationCenter.default.post(name: TableShake.shaken, object: nil)
    }
    // After the swap this is what motionEnded was before.
    table_motionEnded(motion, with: event)
  }
}
