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
