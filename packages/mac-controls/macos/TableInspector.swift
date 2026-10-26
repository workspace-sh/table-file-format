// The window's inspector, for an app that has none of its own: the system's
// trailing pane, where a field's or a view's settings go on a Mac, as the
// Format sidebar does in Pages (deep work; a quick choice is a popover).
// The host adds `makeItem()` to its split view and a toolbar button that
// sends `toggleInspector:`; what's in it is the form the .table library's
// views describe (src/settings.tsx), drawn by TableSettingsForm.swift.
// The demo has its own pane (with a cell's inspector and a row's page as
// well) and uses only the form.

import AppKit
import SwiftUI

@objc(TableInspector)
public final class TableInspector: NSObject {
  /// The form on show; nil for none.
  static let form = TableSettingsFormModel()
  /// A formula being written (TableFormulaEditor.swift); its data nil for none.
  static let formula = TableFormulaEditorModel()
  /// What's typed and pressed in the formula's editor, for the app.
  static var sendFormula: ([String: Any]) -> Void = { _ in }
  /// What's done in it, and the pane closing, for the app (TableMacControls.m sends them on).
  static var send: ([String: Any]) -> Void = { _ in }

  private static weak var item: NSSplitViewItem?
  /// The pane was opened for the formula being written, so closes when it ends.
  private static var openedForFormula = false
  private static var watch: NSKeyValueObservation?

  /// The pane, closed, for the host's split view.
  @objc public static func makeItem() -> NSSplitViewItem {
    let host = NSHostingController(rootView: InspectorPane(form: form, formula: formula))
    formula.send = { event in sendFormula(event) }
    // Sized by the pane, never the other way: a hosting view otherwise holds
    // its window to its content's size, which with no form is no height at all.
    host.sizingOptions = []
    let item = NSSplitViewItem(inspectorWithViewController: host)
    item.minimumThickness = 280
    item.maximumThickness = 480
    item.canCollapse = true
    item.isCollapsed = true
    self.item = item
    form.send = { event in send(event) }
    // Closed by its toolbar button or by dragging: the form is let go of, as
    // a tap outside a sheet lets go of one.
    watch = item.observe(\.isCollapsed, options: [.new]) { item, _ in
      if item.isCollapsed && form.data != nil { send(["what": "closed"]) }
    }
    return item
  }

  /// The form to show, as the library describes it (JSON); "" for none.
  /// A form opens the pane; none leaves it as it is.
  @objc public static func setForm(_ json: String) {
    var data: SettingsFormData?
    if let bytes = json.data(using: .utf8), !json.isEmpty {
      do {
        data = try JSONDecoder().decode(SettingsFormData.self, from: bytes)
      } catch {
        NSLog("TableInspector: a settings form that doesn't decode: %@", "\(error)")
      }
    }
    form.data = data
    if data != nil, let item, item.isCollapsed {
      item.animator().isCollapsed = false
    }
  }

  /// Where what's done in the form goes: the module's event to React.
  @objc public static func listen(_ then: @escaping (NSDictionary) -> Void) {
    send = { event in then(event as NSDictionary) }
  }

  /// The formula being written, as glass-bar's editor state says it (JSON,
  /// TableFormulaEditor.swift); "" for none. One opens the pane; none hands
  /// the keyboard back to the table.
  @objc public static func setFormula(_ json: String) {
    var data: FormulaEditorData?
    if let bytes = json.data(using: .utf8), !json.isEmpty {
      do {
        data = try JSONDecoder().decode(FormulaEditorData.self, from: bytes)
      } catch {
        NSLog("TableInspector: a formula editor that doesn't decode: %@", "\(error)")
      }
    }
    let field = formula.textView
    let hadKeyboard = field.window?.firstResponder === field
    let window = field.window
    formula.data = data
    if data != nil, let item, item.isCollapsed {
      item.animator().isCollapsed = false
      openedForFormula = true
    }
    // Opened for it, the pane goes with the formula, unless a form has come in since.
    if data == nil, openedForFormula {
      openedForFormula = false
      if form.data == nil, let item, !item.isCollapsed { item.animator().isCollapsed = true }
    }
    // The edit is over: the keyboard back to the window's content, not the
    // next field that takes it (the toolbar's search).
    if data == nil && hadKeyboard { window?.makeFirstResponder(window?.contentView) }
  }

  /// Put text into the formula at its cursor (a clicked column's name), the cursor then `cursorBack` back.
  @objc public static func insertInFormula(_ text: String, cursorBack: Int) {
    formula.insert(text, cursorBack: cursorBack)
  }

  /// Where what's typed and pressed in the formula's editor goes.
  @objc public static func listenToFormula(_ then: @escaping (NSDictionary) -> Void) {
    sendFormula = { event in then(event as NSDictionary) }
  }

  /// Open or close the pane, as its toolbar button does.
  @objc public static func setShown(_ shown: Bool) {
    guard let item, item.isCollapsed == shown else { return }
    item.animator().isCollapsed = !shown
  }
}

/// The pane: a settings form, else a formula being written, else a word on what goes here.
private struct InspectorPane: View {
  @ObservedObject var form: TableSettingsFormModel
  @ObservedObject var formula: TableFormulaEditorModel

  var body: some View {
    if form.data == nil && formula.data != nil {
      TableFormulaEditorView(model: formula)
    } else if form.data != nil {
      // A narrow margin from the pane's sides, as the demo's own pane has.
      TableSettingsFormView(model: form, sideMargin: 3)
    } else {
      Text("No Selection")
        .font(.title3)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}
