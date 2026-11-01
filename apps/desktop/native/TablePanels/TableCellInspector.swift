// The inspector for a selected cell: the system's grouped form, as an
// inspector is on a Mac. What it says is the app's (the same selection
// the iOS bar shows, with its words), sent as JSON; its buttons go back
// as events. React draws the inspector's other contents (a row's page, a
// formula being written, the view's settings) in its own view under this.

import SwiftUI

struct CellInspectorData: Decodable, Equatable {
  /// The field's title, and the row's.
  var field: String
  var row: String
  var rowLabel: String
  /// The value as the cell shows it, or the formula as typed.
  var value: String
  var valueLabel: String
  var formula: Bool
  /// What the field is, a paragraph each: its kind and rules, its description, its formula, its stored key.
  var aboutLabel: String
  var about: [String]
  var editLabel: String
  /// Absent where the schema can't be edited.
  var settingsLabel: String?
}

final class TableCellInspectorModel: ObservableObject {
  @Published var data: CellInspectorData?
  /// A button pressed: "edit" or "settings".
  var send: (String) -> Void = { _ in }
}

struct TableCellInspectorView: View {
  @ObservedObject var model: TableCellInspectorModel

  var body: some View {
    if let data = model.data {
      Form {
        Section(data.field) {
          LabeledContent(data.rowLabel, value: data.row)
          LabeledContent(data.valueLabel) {
            Text(data.value.isEmpty ? "—" : data.value)
              .font(data.formula ? .body.monospaced() : .body)
              .textSelection(.enabled)
              .multilineTextAlignment(.trailing)
          }
        }
        if !data.about.isEmpty {
          Section(data.aboutLabel) {
            ForEach(Array(data.about.enumerated()), id: \.offset) { _, line in
              Text(line).textSelection(.enabled)
            }
          }
        }
        Section {
          HStack {
            Button(data.editLabel) { model.send("edit") }
            if let settings = data.settingsLabel {
              Button(settings) { model.send("settings") }
            }
          }
        }
      }
      .formStyle(.grouped)
      // On the pane's own material, not a second background.
      .scrollContentBackground(.hidden)
    }
  }
}
