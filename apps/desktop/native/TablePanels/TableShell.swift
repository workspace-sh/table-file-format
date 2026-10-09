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

  static weak var inspectorItem: NSSplitViewItem?
  private static var inspectorWatch: NSKeyValueObservation?

  @objc public static func create(rootView: NSView, inspectorView: NSView) -> NSViewController {
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
    // The pane paints the window's background and the React view paints none.
    //
    // TODO(#383): content that scrolls up behind the toolbar should be
    // softened by the system's soft scroll-edge effect, with no band and no
    // line under the toolbar. The setup meant to give that:
    //   1. AppDelegate: a unified NSToolbar over full-size content, the
    //      title bar not transparent (a transparent one opts the window
    //      out of the effect), titlebarSeparatorStyle = .none.
    //   2. App.tsx: the pane's ScrollView calls adoptToolbarInsets() on
    //      layout, which sets automaticallyAdjustsContentInsets on its
    //      NSScrollView (TableMenu.m). React Native macOS turns that off
    //      in RCTEnhancedScrollView.
    //   3. ContentBackgroundView below: the window's background colour.
    // With this the system draws a dimmed strip with a faint edge, not the
    // soft effect. What else was tried, and what to try next, is in #383.
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

    // The inspector: the system's trailing pane, for what's selected (a
    // cell and its formula, a row's page). Its own React view, in the same
    // JavaScript runtime as the main one, so it shows what the app hands it
    // (inspectorStore.ts). It starts closed, and keeps clear of the toolbar.
    let inspector = NSViewController()
    let pane = NSView()
    inspectorView.translatesAutoresizingMaskIntoConstraints = false
    pane.addSubview(inspectorView)
    NSLayoutConstraint.activate([
      inspectorView.topAnchor.constraint(equalTo: pane.safeAreaLayoutGuide.topAnchor),
      inspectorView.leadingAnchor.constraint(equalTo: pane.leadingAnchor),
      inspectorView.trailingAnchor.constraint(equalTo: pane.trailingAnchor),
      inspectorView.bottomAnchor.constraint(equalTo: pane.bottomAnchor),
    ])
    inspector.view = pane
    let inspectorItem = NSSplitViewItem(inspectorWithViewController: inspector)
    inspectorItem.minimumThickness = 300
    inspectorItem.maximumThickness = 560
    inspectorItem.canCollapse = true
    inspectorItem.isCollapsed = true
    self.inspectorItem = inspectorItem
    // Closed by its toolbar button or by dragging: the app is told, so it
    // can let go of what the inspector was showing.
    inspectorWatch = inspectorItem.observe(\.isCollapsed, options: [.new]) { item, _ in
      sidebar.send("inspector", ["shown": !item.isCollapsed])
    }

    split.addSplitViewItem(sidebarItem)
    split.addSplitViewItem(detailItem)
    split.addSplitViewItem(inspectorItem)
    split.splitView.autosaveName = "TableDesktopSplitView"
    watchClicks()
    return split
  }

  /// Give the keyboard to the content, unless something in it already has
  /// it. The sidebar's list is the window's first choice for the keyboard,
  /// and holds on to it when a click lands on a part of the React view
  /// that doesn't take focus itself: arrow keys and typing would then move
  /// about the sidebar while the table looked selected.
  @objc public static func focusContent() {
    guard let root = rootView, let window = root.window else { return }
    if let first = window.firstResponder as? NSView, first.isDescendant(of: root) { return }
    if !window.makeFirstResponder(root) { window.makeFirstResponder(nil) }
  }

  /// A click in the content takes the keyboard from the sidebar before the
  /// click itself is handled, so whatever it lands on can then claim it.
  private static var clickMonitor: Any?
  static func watchClicks() {
    guard clickMonitor == nil else { return }
    clickMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
      if let root = rootView, let window = root.window, event.window === window,
         event.locationInWindow.y <= window.contentLayoutRect.maxY,
         root.bounds.contains(root.convert(event.locationInWindow, from: nil)) {
        focusContent()
      }
      return event
    }
  }

  /// Open or close the inspector, as its toolbar button does.
  @objc public static func setInspectorShown(_ shown: Bool) {
    guard let item = inspectorItem, item.isCollapsed == shown else { return }
    item.animator().isCollapsed = !shown
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
