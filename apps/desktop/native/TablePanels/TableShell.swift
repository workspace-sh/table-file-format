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
    // its own top clear by the toolbar's height (TableMenu.topInset). The
    // pane paints the content's background and the React view paints none,
    // so the toolbar and the content under it are one surface.
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
    // Behind the toolbar, content that has scrolled up is softened: a light
    // blur and a fade toward the content's own colour, strongest at the top
    // and gone just below the toolbar, so its title and buttons stay
    // legible and what's beneath still shows through. At rest the fade is
    // the colour already there, so nothing shows.
    let edge = ToolbarEdgeView()
    edge.translatesAutoresizingMaskIntoConstraints = false
    holder.addSubview(edge, positioned: .above, relativeTo: rootView)
    NSLayoutConstraint.activate([
      edge.topAnchor.constraint(equalTo: holder.topAnchor),
      edge.leadingAnchor.constraint(equalTo: holder.leadingAnchor),
      edge.trailingAnchor.constraint(equalTo: holder.trailingAnchor),
      edge.bottomAnchor.constraint(equalTo: holder.safeAreaLayoutGuide.topAnchor, constant: ToolbarEdgeView.reach),
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

/// The soft edge under the toolbar: what's behind it blurred a little and
/// faded toward the content's colour, both easing out downward. It takes
/// no clicks.
final class ToolbarEdgeView: NSView {
  /// How far below the toolbar the softening reaches before it's gone.
  static let reach: CGFloat = 22
  private let scrim = CAGradientLayer()
  private let fade = CAGradientLayer()

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layerUsesCoreImageFilters = true
    if let blur = CIFilter(name: "CIGaussianBlur", parameters: [kCIInputRadiusKey: 7]) {
      backgroundFilters = [blur]
    }
    layer?.addSublayer(scrim)
    // Both ease out toward the bottom edge: full at the top, none at the foot.
    fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    fade.locations = [0, 0.45, 1]
    layer?.mask = fade
  }

  required init?(coder: NSCoder) { fatalError("not from a nib") }

  override var isFlipped: Bool { true }

  override func layout() {
    super.layout()
    scrim.frame = bounds
    fade.frame = bounds
    recolour()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    recolour()
  }

  private func recolour() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let fill = ContentBackgroundView.fill
      scrim.colors = [fill.withAlphaComponent(0.82).cgColor, fill.withAlphaComponent(0.55).cgColor, fill.withAlphaComponent(0).cgColor]
      scrim.locations = [0, 0.6, 1]
    }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// The content's background: white, or near black in the dark appearance,
/// as table-ui's views are drawn on.
final class ContentBackgroundView: NSView {
  static let fill = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      ? NSColor(srgbRed: 0x0e / 255, green: 0x0e / 255, blue: 0x10 / 255, alpha: 1)
      : .white
  }

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
      layer?.backgroundColor = ContentBackgroundView.fill.cgColor
    }
  }
}
