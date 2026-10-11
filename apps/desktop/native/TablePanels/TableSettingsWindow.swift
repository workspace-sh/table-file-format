// The app's Settings window (⌘,): how the viewer reads tables, whatever
// file is open: language and region, dates, and the syntax formulas are
// shown in. The choices are the app's (table-app's display settings),
// sent as the same sections of rows the inspector's forms are, and drawn
// by the same view.

import AppKit
import SwiftUI

@objc(TableSettingsWindow)
public final class TableSettingsWindow: NSObject {
  @objc public static let shared = TableSettingsWindow()
  static let model = TableSettingsFormModel()

  private var window: NSWindow?

  /// The app menu's Settings item opens the window. The template's item
  /// has the key (⌘,) and nothing to do; it is given this, and the name
  /// the system has used since macOS 13.
  @objc public func install() {
    guard let appMenu = NSApp.mainMenu?.items.first?.submenu,
          let item = appMenu.items.first(where: { $0.keyEquivalent == "," }) else { return }
    item.title = "Settings…"
    item.target = self
    item.action = #selector(show)
  }

  @objc public func show() {
    if window == nil {
      let host = NSHostingController(rootView: TableSettingsFormView(model: TableSettingsWindow.model).frame(width: 460))
      let made = NSWindow(contentViewController: host)
      made.styleMask = [.titled, .closable]
      made.title = "Settings"
      made.isReleasedWhenClosed = false
      made.center()
      window = made
    }
    window?.makeKeyAndOrderFront(nil)
  }

  /// Development only: whether the window is showing, and closing it.
  @objc public var isShown: Bool { window?.isVisible ?? false }
  @objc public func close() { window?.close() }
}
