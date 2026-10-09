// The window's layout, as a Mac app's: a split view whose first item is a
// real sidebar (the system gives it its material, its collapse and its
// place under the toolbar) and whose second holds the React Native view.
// AppDelegate builds the window around what `create` returns.

import AppKit
import SwiftUI

@objc(TableShell)
public class TableShell: NSObject {
  static let sidebar = TableSidebarModel()
  static weak var split: NSSplitViewController?
  /// The React Native view, for the development hooks that click in it.
  @objc public static weak var rootView: NSView?

  @objc public static func create(rootView: NSView) -> NSViewController {
    self.rootView = rootView
    let split = NSSplitViewController()
    self.split = split

    let sidebarController = NSHostingController(rootView: TableSidebarView(model: sidebar))
    let sidebarItem = NSSplitViewItem(sidebarWithViewController: sidebarController)
    sidebarItem.minimumThickness = 240
    sidebarItem.maximumThickness = 360
    sidebarItem.canCollapse = true

    // The content keeps clear of the toolbar: the React view is pinned to
    // the safe area, which the window's full-size content otherwise ignores.
    let detail = NSViewController()
    let holder = NSView()
    rootView.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(rootView)
    NSLayoutConstraint.activate([
      rootView.topAnchor.constraint(equalTo: holder.safeAreaLayoutGuide.topAnchor),
      rootView.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
      rootView.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
      rootView.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
    ])
    detail.view = holder
    let detailItem = NSSplitViewItem(viewController: detail)
    detailItem.minimumThickness = 420

    split.addSplitViewItem(sidebarItem)
    split.addSplitViewItem(detailItem)
    split.splitView.autosaveName = "TableDesktopSplitView"
    return split
  }

  /// Whether the sidebar is showing, for the View menu's Hide/Show Sidebar.
  @objc public static var sidebarShown: Bool {
    !(split?.splitViewItems.first?.isCollapsed ?? false)
  }
}
