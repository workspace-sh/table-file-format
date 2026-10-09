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
    // The pane paints the window's background and the React view paints none.
    //
    // TODO(toolbar blur): NOT DONE. Parked on 9 Oct 2026.
    //
    // Wanted: content that scrolls up behind the toolbar stays visible but
    // is softened, so the title and buttons stay legible, with no band and
    // no line under the toolbar. The references are Apple Maps on macOS 26
    // (the blur along the top of its window) and Workspace's iOS document
    // screen, which gets it from the system, not from drawing:
    // workspace-sh/workspace, apps/mobile/src/app/index.tsx:
    //   <Stack.Screen options={{ scrollEdgeEffects: { top: "soft" } }} />
    //   <Stack.Header blurEffect="none" />
    // plus contentInsetAdjustmentBehavior="automatic" on the scroll view.
    //
    // What is set up here, meant as the Mac equivalent:
    //   1. AppDelegate: an NSToolbar, unified, full-size content, title bar
    //      NOT transparent, titlebarSeparatorStyle = .none.
    //   2. App.tsx: the pane's ScrollView calls adoptToolbarInsets() on
    //      layout, which sets automaticallyAdjustsContentInsets = YES on
    //      its NSScrollView (TableMenu.m). React Native macOS turns that
    //      off in RCTEnhancedScrollView.
    //   3. ContentBackgroundView below: the window's background colour.
    // Result: the system draws a dimmed, lightly blurred strip behind the
    // toolbar with a faint edge under it. It is not the soft look wanted.
    //
    // Tried, and what happened:
    //   - titlebarAppearsTransparent = true: no effect at all; content
    //     passes sharp behind the title. Same in a bare AppKit window.
    //   - An NSSplitViewItemAccessoryViewController (and, in a bare window,
    //     an NSTitlebarAccessoryViewController) with
    //     preferredScrollEdgeEffectStyle = .soft (macOS 26.1): no visible
    //     change.
    //   - A bare SwiftUI window, ScrollView + .scrollEdgeEffectStyle(.soft,
    //     for: .top) against .hard: the two looked the same.
    //   - Drawing it here: an NSVisualEffectView with a gradient mask (a
    //     frosted panel, wrong); a CIGaussianBlur background filter with a
    //     fade to the content colour (closest, but dims more than it
    //     blurs); CIMaskedVariableBlur as a background filter (weak, and
    //     the whole pane rendered soft, as if at 1x).
    // All of that was seen only in an inactive window on macOS 27.2 beta
    // (the screen was locked). Not seen: an active window, or macOS 26.
    //
    // Where to look next:
    //   - Run this build in an active window first: the effect may simply
    //     differ there.
    //   - AppKit exposes the style only on accessories
    //     (NSScrollEdgeEffect.h). SwiftUI exposes it on any scroll view, so
    //     hosting the pane in SwiftUI, or the toolbar as SwiftUI .toolbar,
    //     may be the way to ask for .soft.
    //   - Maps is not a scroll view, so its blur is likely its own view
    //     (NSBackgroundExtensionView, or a variable blur), not this effect.
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
