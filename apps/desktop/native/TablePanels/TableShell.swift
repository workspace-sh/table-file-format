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

    // The content runs the pane's full height, under the toolbar, so the
    // toolbar floats over it as the system draws one; what's in it keeps
    // The pane paints the window's background and the React view paints
    // none. What scrolls up behind the toolbar is softened by the system's
    // own scroll-edge effect, as in any Mac app: that needs the toolbar to
    // keep its standard (not transparent) title bar, and the pane's scroll
    // view to have its top inset managed by the system
    // (TableMenu.adoptToolbarInsets), which is all the setup there is.
    let detail = NSViewController()
    let holder = ContentBackgroundView()
    rootView.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(rootView)
    NSLayoutConstraint.activate([
      rootView.topAnchor.constraint(equalTo: holder.topAnchor),
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

/// The content's background: the window's own, so the pane and the toolbar
/// over it are one surface and the system's scroll-edge effect meets it
/// without a seam.
final class ContentBackgroundView: NSView {
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
  }

  required init?(coder: NSCoder) { fatalError("not from a nib") }

  override var wantsUpdateLayer: Bool { true }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    needsDisplay = true
  }

  override func updateLayer() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }
  }
}
