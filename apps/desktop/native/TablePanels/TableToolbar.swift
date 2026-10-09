// The window's toolbar, in the title bar's row as a Mac app's is: the
// sidebar's button, Back and Forward, the view's own actions, and search.
// Each button is one of the app's commands, sent to JS by its id exactly as
// its menu item is (TableMenu), so every toolbar item is also in the menu
// bar and does the same thing. Search sends its text as it is typed.

import AppKit

extension NSToolbarItem.Identifier {
  static let tableMode = NSToolbarItem.Identifier("table.mode")
  static let tableNavigate = NSToolbarItem.Identifier("table.navigate")
  static let tableNewRow = NSToolbarItem.Identifier("table.newRow")
  static let tableViewSettings = NSToolbarItem.Identifier("table.viewSettings")
  static let tableExport = NSToolbarItem.Identifier("table.export")
  static let tableSearch = NSToolbarItem.Identifier("table.search")
}

extension Notification.Name {
  /// A command chosen from the toolbar: userInfo["id"] is its id.
  static let tableCommand = Notification.Name("TableDesktopCommand")
  /// The search field's text, as typed: userInfo["text"].
  static let tableSearch = Notification.Name("TableDesktopSearch")
}

@objc(TableToolbar)
public class TableToolbar: NSObject, NSToolbarDelegate, NSSearchFieldDelegate {
  @objc public static let shared = TableToolbar()

  /// Commands that can't be chosen right now, by id (Back with nowhere to go back to).
  @objc public static var disabled = Set<String>()
  /// The buttons' labels and hints, by command id, as JS words them.
  private var labels: [String: String] = [:]
  private weak var searchItem: NSSearchToolbarItem?
  private weak var modeItem: NSToolbarItemGroup?
  private var filesMode = false
  private weak var toolbar: NSToolbar?

  @objc public func make() -> NSToolbar {
    let toolbar = NSToolbar(identifier: "TableDesktopToolbar")
    toolbar.displayMode = .iconOnly
    toolbar.delegate = self
    self.toolbar = toolbar
    return toolbar
  }

  /// The label for a command's button, and its hint.
  @objc public func setLabel(_ label: String, for id: String) {
    labels[id] = label
    for item in toolbar?.items ?? [] {
      if let group = item as? NSToolbarItemGroup {
        for sub in group.subitems where sub.itemIdentifier.rawValue == id { sub.label = label; sub.toolTip = label }
      } else if commandId(of: item) == id {
        item.label = label
        item.toolTip = label
      }
    }
  }

  /// Which side of the sidebar is showing: its tables and views, or its files.
  @objc public func setFilesMode(_ files: Bool) {
    filesMode = files
    modeItem?.selectedIndex = files ? 1 : 0
  }

  @objc private func chooseMode(_ sender: NSToolbarItemGroup) {
    let id = sender.selectedIndex == 1 ? "files-mode" : "tables-mode"
    NotificationCenter.default.post(name: .tableCommand, object: nil, userInfo: ["id": id])
  }

  /// The search field's text, when the app changes it (leaving a view clears it).
  @objc public func setSearch(_ text: String) {
    guard let field = searchItem?.searchField, field.stringValue != text else { return }
    field.stringValue = text
  }

  /// Put the cursor in the search field, as Find (⌘F) does.
  @objc public func focusSearch() {
    searchItem?.beginSearchInteraction()
  }

  private func commandId(of item: NSToolbarItem) -> String? {
    switch item.itemIdentifier {
    case .tableNewRow: return "new-row"
    case .tableViewSettings: return "view-settings"
    case .tableExport: return "export-zip"
    default: return nil
    }
  }

  private func button(_ identifier: NSToolbarItem.Identifier, id: String, symbol: String, fallback: String) -> NSToolbarItem {
    let item = NSToolbarItem(itemIdentifier: identifier)
    let label = labels[id] ?? fallback
    item.label = label
    item.paletteLabel = label
    item.toolTip = label
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
    item.isBordered = true
    item.target = self
    item.action = #selector(choose(_:))
    return item
  }

  @objc private func choose(_ sender: NSToolbarItem) {
    guard let id = commandId(of: sender) else { return }
    NotificationCenter.default.post(name: .tableCommand, object: nil, userInfo: ["id": id])
  }

  @objc private func navigate(_ sender: NSToolbarItemGroup) {
    let id = sender.selectedIndex == 0 ? "go-back" : "go-forward"
    NotificationCenter.default.post(name: .tableCommand, object: nil, userInfo: ["id": id])
  }

  // MARK: NSToolbarDelegate

  public func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [.toggleSidebar, .tableMode, .sidebarTrackingSeparator, .tableNavigate, .flexibleSpace, .space,
     .tableNewRow, .tableViewSettings, .tableExport, .tableSearch]
  }

  public func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [.toggleSidebar, .tableMode, .sidebarTrackingSeparator, .tableNavigate, .flexibleSpace,
     .tableNewRow, .tableViewSettings, .tableExport, .tableSearch]
  }

  public func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                      willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
    switch identifier {
    case .tableMode:
      // Over the sidebar, in the toolbar, where the system draws it as its other controls.
      let tables = labels["tables-mode"] ?? "Tables"
      let files = labels["files-mode"] ?? "Files"
      // Symbols, so both fit beside the sidebar's button in the sidebar's width; their names are the hints.
      let group = NSToolbarItemGroup(
        itemIdentifier: identifier,
        images: [
          NSImage(systemSymbolName: "tablecells", accessibilityDescription: tables)!,
          NSImage(systemSymbolName: "folder", accessibilityDescription: files)!,
        ],
        selectionMode: .selectOne, labels: [tables, files], target: self, action: #selector(chooseMode(_:)))
      for (sub, hint) in zip(group.subitems, [tables, files]) { sub.toolTip = hint }
      group.label = "\(tables)/\(files)"
      group.selectedIndex = filesMode ? 1 : 0
      modeItem = group
      return group
    case .tableNavigate:
      let back = labels["go-back"] ?? "Back"
      let forward = labels["go-forward"] ?? "Forward"
      let group = NSToolbarItemGroup(
        itemIdentifier: identifier,
        images: [
          NSImage(systemSymbolName: "chevron.backward", accessibilityDescription: back)!,
          NSImage(systemSymbolName: "chevron.forward", accessibilityDescription: forward)!,
        ],
        selectionMode: .momentary,
        labels: [back, forward],
        target: self,
        action: #selector(navigate(_:)))
      group.label = "\(back)/\(forward)"
      group.isNavigational = true
      return group
    case .tableNewRow:
      return button(identifier, id: "new-row", symbol: "plus", fallback: "New Row")
    case .tableViewSettings:
      return button(identifier, id: "view-settings", symbol: "slider.horizontal.3", fallback: "View Settings")
    case .tableExport:
      return button(identifier, id: "export-zip", symbol: "square.and.arrow.up", fallback: "Export")
    case .tableSearch:
      let item = NSSearchToolbarItem(itemIdentifier: identifier)
      item.searchField.delegate = self
      item.searchField.sendsSearchStringImmediately = true
      item.searchField.target = self
      item.searchField.action = #selector(searched(_:))
      searchItem = item
      return item
    default:
      return nil
    }
  }

  @objc private func searched(_ sender: NSSearchField) {
    NotificationCenter.default.post(name: .tableSearch, object: nil, userInfo: ["text": sender.stringValue])
  }

  public func controlTextDidChange(_ notification: Notification) {
    guard let field = notification.object as? NSSearchField else { return }
    NotificationCenter.default.post(name: .tableSearch, object: nil, userInfo: ["text": field.stringValue])
  }
}

extension TableToolbar: NSToolbarItemValidation {
  public func validateToolbarItem(_ item: NSToolbarItem) -> Bool {
    guard let id = commandId(of: item) else { return true }
    return !TableToolbar.disabled.contains(id)
  }
}
