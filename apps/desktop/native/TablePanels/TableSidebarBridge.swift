// The sidebar's data in, and its clicks out. JS sends the model as JSON
// (table-app's sidebar tree and Files lines, with the words to show); a
// click comes back as a TableSidebarEvent with its name and what it was on.

import AppKit
import React
import TableMacControls

@objc(TableSidebar)
class TableSidebar: RCTEventEmitter {
  private var listening = false

  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String] { ["TableSidebarEvent"] }

  override func startObserving() {
    listening = true
    TableShell.sidebar.send = { [weak self] name, body in
      guard let self, self.listening else { return }
      var event = body
      event["type"] = name
      self.sendEvent(withName: "TableSidebarEvent", body: event)
    }
  }

  override func stopObserving() {
    listening = false
  }

  @objc func setModel(_ json: String) {
    guard let bytes = json.data(using: .utf8),
          let data = try? JSONDecoder().decode(SidebarModelData.self, from: bytes) else {
      NSLog("TableSidebar: a model that couldn't be read")
      return
    }
    DispatchQueue.main.async {
      TableShell.sidebar.data = data
    }
  }

  /// Development only: pick a row as a click on it does, by its tag
  /// (`table:<key>`, `view:<key>:<viewId>`) or a Files line's id.
  @objc func pick(_ tag: String) {
    DispatchQueue.main.async {
      if tag.hasPrefix("table:") || tag.hasPrefix("view:") {
        TableShell.sidebar.pick(tag)
      } else {
        TableShell.sidebar.pickFile(tag)
      }
    }
  }

  /// The selected cell, for the inspector to say (TableCellInspector.swift); "" for none.
  @objc func setInspectorCell(_ json: String) {
    let data = json.data(using: .utf8).flatMap { try? JSONDecoder().decode(CellInspectorData.self, from: $0) }
    DispatchQueue.main.async {
      TableShell.setInspectorCell(data)
    }
  }

  /// The formula being written, for the inspector's editor (TableFormulaEditor.swift); "" for none.
  @objc func setFormulaEditor(_ json: String) {
    var data: FormulaEditorData?
    if let bytes = json.data(using: .utf8), !json.isEmpty {
      do {
        data = try JSONDecoder().decode(FormulaEditorData.self, from: bytes)
      } catch {
        NSLog("TableSidebar: a formula editor that couldn't be read: %@", String(describing: error))
      }
    }
    DispatchQueue.main.async {
      TableShell.setFormulaEditor(data)
    }
  }

  /// Put text into the formula at its cursor (a clicked column's name), the cursor then `cursorBack` back.
  @objc func insertInFormula(_ text: String, cursorBack: NSNumber) {
    DispatchQueue.main.async {
      TableShell.formulaEditor.insert(text, cursorBack: cursorBack.intValue)
    }
  }

  /// Development only: type a whole formula into the editor, or press what `what` names ("save", "cancel", "submit", "fix", "settings").
  @objc func driveFormulaEditor(_ what: String, text: String) {
    DispatchQueue.main.async {
      let model = TableShell.formulaEditor
      if what == "type" {
        model.type(text)
      } else if what == "save" || what == "submit" {
        model.send(["what": what, "text": model.textView.string])
      } else {
        model.send(["what": what])
      }
    }
  }

  /// The settings form for the inspector to show (@workspace.sh/table-mac-controls, TableSettingsForm.swift); "" for none.
  @objc func setSettingsForm(_ json: String) {
    var data: SettingsFormData?
    if let bytes = json.data(using: .utf8), !json.isEmpty {
      do {
        data = try JSONDecoder().decode(SettingsFormData.self, from: bytes)
      } catch {
        NSLog("TableSidebar: a settings form that couldn't be read: %@", String(describing: error))
      }
    }
    DispatchQueue.main.async {
      TableShell.setSettingsForm(data)
    }
  }

  /// The app's settings, for its Settings window (TableSettingsWindow.swift): a settings form's JSON.
  @objc func setAppSettings(_ json: String) {
    guard let bytes = json.data(using: .utf8),
          let data = try? JSONDecoder().decode(SettingsFormData.self, from: bytes) else {
      NSLog("TableSidebar: app settings that couldn't be read")
      return
    }
    DispatchQueue.main.async {
      TableSettingsWindow.model.data = data
    }
  }

  /// Development only: open or close the Settings window, as ⌘, and its close button do; and what a control in it would send, as JSON.
  @objc func showAppSettings(_ shown: Bool) {
    DispatchQueue.main.async {
      if shown { TableSettingsWindow.shared.show() } else { TableSettingsWindow.shared.close() }
    }
  }
  @objc func sendAppSettings(_ json: String) {
    guard let bytes = json.data(using: .utf8),
          let event = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return }
    DispatchQueue.main.async {
      TableSettingsWindow.model.send(event)
    }
  }

  /// Development only: send what a control in the settings form would, as JSON.
  @objc func sendSettingsForm(_ json: String) {
    guard let bytes = json.data(using: .utf8),
          let event = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return }
    DispatchQueue.main.async {
      TableShell.settingsForm.send(event)
    }
  }

  /// Development only: press one of the cell inspector's buttons ("edit" or "settings").
  @objc func pressInspectorCell(_ action: String) {
    DispatchQueue.main.async {
      TableShell.cellInspector.send(action)
    }
  }

  /// Open or close the inspector.
  @objc func setInspectorShown(_ shown: Bool) {
    DispatchQueue.main.async {
      TableShell.setInspectorShown(shown)
    }
  }

  /// Show or hide the sidebar, as View › Hide Sidebar and the toolbar's button do.
  @objc func toggle() {
    DispatchQueue.main.async {
      TableShell.split?.toggleSidebar(nil)
    }
  }
}
