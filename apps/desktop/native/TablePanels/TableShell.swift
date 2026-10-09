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
  static weak var blur: ToolbarBlurView?
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
    // its own top clear by the toolbar's height (TableMenu.topInset).
    let detail = NSViewController()
    let holder = NSView()
    rootView.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(rootView)
    NSLayoutConstraint.activate([
      rootView.topAnchor.constraint(equalTo: holder.topAnchor),
      rootView.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
      rootView.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
      rootView.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
    ])
    // Where content has scrolled up behind the toolbar's buttons it is
    // blurred, fading out below them, so they stay legible without the
    // toolbar having a backing or an edge of its own (setContentUnderToolbar).
    let blur = ToolbarBlurView()
    blur.alphaValue = 0
    self.blur = blur
    blur.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(blur, positioned: .above, relativeTo: rootView)
    NSLayoutConstraint.activate([
      blur.topAnchor.constraint(equalTo: holder.topAnchor),
      blur.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
      blur.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
      blur.bottomAnchor.constraint(equalTo: holder.safeAreaLayoutGuide.topAnchor, constant: ToolbarBlurView.fade),
    ])
    detail.view = holder
    let detailItem = NSSplitViewItem(viewController: detail)
    detailItem.minimumThickness = 420

    split.addSplitViewItem(sidebarItem)
    split.addSplitViewItem(detailItem)
    split.splitView.autosaveName = "TableDesktopSplitView"
    return split
  }

  /// Whether content has scrolled up behind the toolbar: the blur is there
  /// only then, so at rest nothing sits between the toolbar and the content.
  @objc public static func setContentUnderToolbar(_ under: Bool) {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.18
      blur?.animator().alphaValue = under ? 1 : 0
    }
  }

  /// Whether the sidebar is showing, for the View menu's Hide/Show Sidebar.
  @objc public static var sidebarShown: Bool {
    !(split?.splitViewItems.first?.isCollapsed ?? false)
  }
}

/// A blur of what's behind it in the window, full strength behind the
/// toolbar and fading to nothing just below it. It takes no clicks.
final class ToolbarBlurView: NSVisualEffectView {
  /// How far below the toolbar the blur takes to fade out.
  static let fade: CGFloat = 18

  override init(frame: NSRect) {
    super.init(frame: frame)
    material = .headerView
    blendingMode = .withinWindow
    state = .active
  }

  required init?(coder: NSCoder) { fatalError("not from a nib") }

  override func layout() {
    super.layout()
    let height = max(bounds.height, 1)
    let solid = max(height - ToolbarBlurView.fade, 0) / height
    // The mask's alpha: opaque down to the toolbar's foot, then fading.
    let mask = NSImage(size: NSSize(width: 1, height: height), flipped: false) { rect in
      NSGradient(colorsAndLocations: (NSColor.clear, 0), (NSColor.black, 1 - solid), (NSColor.black, 1))?
        .draw(in: rect, angle: 90)
      return true
    }
    mask.resizingMode = .stretch
    maskImage = mask
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
