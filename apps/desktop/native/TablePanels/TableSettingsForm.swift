// A settings form in the inspector: the system's grouped form, as the
// iOS app's is. table-ui describes a field's settings, a new field and a
// view's settings as sections of rows (its SettingsForm slot); the app
// sends them here as JSON with their words, and what's changed, pressed,
// removed or moved comes back as an event naming the row.

import SwiftUI

struct SettingsOptionData: Decodable, Equatable {
  var value: String
  var label: String
  var disabled: Bool?
}

/// One row, of any kind: "text", "info", "choice", "toggle", "compound" or "action".
struct SettingsRowData: Decodable, Equatable, Identifiable {
  var kind: String
  var id: String
  var label: String?
  /// A text's, an info's or a choice's value.
  var value: String?
  /// A toggle's.
  var on: Bool?
  var placeholder: String?
  var autoFocus: Bool?
  /// A text that Return submits (adding to a list): the whole row, its label its placeholder.
  var submits: Bool?
  var options: [SettingsOptionData]?
  /// A choice's: "menu", "inline" or "segmented".
  var style: String?
  /// A compound's controls.
  var parts: [SettingsRowData]?
  /// An action's: "add" or "destructive".
  var role: String?
  var disabled: Bool?
}

struct SettingsSectionData: Decodable, Equatable, Identifiable {
  var id: String
  var title: String?
  var footer: String?
  var rows: [SettingsRowData]
  /// Its compound rows can be removed, and reordered.
  var removable: Bool
  var movable: Bool
}

struct SettingsFormData: Decodable, Equatable {
  /// Changes with the form shown, so what was typed in one isn't carried to the next.
  var key: String
  var title: String
  var cancel: String?
  var confirm: String?
  var confirmDisabled: Bool?
  var removeLabel: String
  var moveUpLabel: String
  var moveDownLabel: String
  var sections: [SettingsSectionData]
}

final class TableSettingsFormModel: ObservableObject {
  @Published var data: SettingsFormData?
  /// What happened: `what` ("change", "submit", "toggle", "press",
  /// "remove", "move", "cancel", "confirm"), the row or section it was on, and its value.
  var send: ([String: Any]) -> Void = { _ in }
}

private struct TextRow: View {
  let row: SettingsRowData
  let compact: Bool
  let send: ([String: Any]) -> Void
  @State private var text: String
  @FocusState private var focused: Bool

  init(row: SettingsRowData, compact: Bool, send: @escaping ([String: Any]) -> Void) {
    self.row = row
    self.compact = compact
    self.send = send
    _text = State(initialValue: row.value ?? "")
  }

  var body: some View {
    let whole = compact || row.submits == true
    TextField(whole ? "" : (row.label ?? ""), text: $text, prompt: Text(row.placeholder ?? (whole ? (row.label ?? "") : "")))
      .labelsHidden(whole)
      .focused($focused)
      .onChange(of: text) { _, next in
        if next != row.value { send(["what": "change", "id": row.id, "value": next]) }
      }
      // The app's value wins when it isn't what's being typed: a field
      // emptied after its text was added to a list, say.
      .onChange(of: row.value) { _, next in
        if let next, next != text, !focused || next.isEmpty { text = next }
      }
      .onSubmit {
        if row.submits == true { send(["what": "submit", "id": row.id, "value": text]) }
      }
      .onAppear { if row.autoFocus == true { focused = true } }
  }
}

private extension View {
  @ViewBuilder func labelsHidden(_ hidden: Bool) -> some View {
    if hidden { self.labelsHidden() } else { self }
  }
}

private struct ChoiceRow: View {
  let row: SettingsRowData
  let compact: Bool
  let send: ([String: Any]) -> Void

  var body: some View {
    let selection = Binding<String>(
      get: { row.value ?? "" },
      set: { next in if next != row.value { send(["what": "change", "id": row.id, "value": next]) } }
    )
    let picker = Picker(row.label ?? "", selection: selection) {
      ForEach(row.options ?? [], id: \.value) { option in
        Text(option.label).tag(option.value).selectionDisabled(option.disabled == true)
      }
    }
    switch row.style {
    case "inline": picker.pickerStyle(.inline).labelsHidden()
    case "segmented": picker.pickerStyle(.segmented).labelsHidden()
    default: picker.pickerStyle(.menu).labelsHidden(compact)
    }
  }
}

private struct RowView: View {
  let row: SettingsRowData
  var compact = false
  let send: ([String: Any]) -> Void

  var body: some View {
    switch row.kind {
    case "text":
      TextRow(row: row, compact: compact, send: send)
    case "choice":
      ChoiceRow(row: row, compact: compact, send: send)
    case "info":
      LabeledContent(row.label ?? "", value: row.value ?? "")
    case "toggle":
      Toggle(row.label ?? "", isOn: Binding(
        get: { row.on == true },
        set: { next in if next != (row.on == true) { send(["what": "toggle", "id": row.id, "value": next]) } }
      ))
    case "action":
      Button(role: row.role == "destructive" ? .destructive : nil) {
        send(["what": "press", "id": row.id])
      } label: {
        if row.role == "add" {
          Label(row.label ?? "", systemImage: "plus")
        } else {
          Text(row.label ?? "")
        }
      }
      .disabled(row.disabled == true)
    default:
      EmptyView()
    }
  }
}

struct TableSettingsFormView: View {
  @ObservedObject var model: TableSettingsFormModel

  var body: some View {
    if let data = model.data {
      VStack(spacing: 0) {
        Form {
          // What the settings are of, at the head of the form and scrolling with it.
          Section {} header: {
            Text(data.title).font(.headline).foregroundStyle(.primary).textCase(nil)
          }
          ForEach(data.sections) { section in
            Section {
              let listed = section.rows.filter { $0.kind == "compound" }
              ForEach(Array(listed.enumerated()), id: \.element.id) { index, row in
                let parts = row.parts ?? []
                // Two controls share a line with the row's menu; a third
                // (a filter's value) has the line under them to itself.
                VStack(alignment: .leading, spacing: 6) {
                  HStack(spacing: 6) {
                    ForEach(parts.prefix(2)) { part in
                      RowView(row: part, compact: true, send: model.send)
                    }
                    Spacer(minLength: 0)
                    if section.removable || section.movable {
                      Menu {
                        if section.movable {
                          Button(data.moveUpLabel) { model.send(["what": "move", "section": section.id, "from": index, "to": index - 1]) }
                            .disabled(index == 0)
                          Button(data.moveDownLabel) { model.send(["what": "move", "section": section.id, "from": index, "to": index + 1]) }
                            .disabled(index == listed.count - 1)
                        }
                        if section.removable {
                          Button(data.removeLabel, role: .destructive) { model.send(["what": "remove", "section": section.id, "index": index]) }
                        }
                      } label: {
                        Image(systemName: "ellipsis.circle")
                      }
                      .menuStyle(.borderlessButton)
                      .menuIndicator(.hidden)
                      .fixedSize()
                    }
                  }
                  if parts.count > 2 {
                    HStack(spacing: 6) {
                      ForEach(parts.dropFirst(2)) { part in
                        RowView(row: part, compact: true, send: model.send)
                      }
                    }
                  }
                }
              }
              ForEach(section.rows.filter { $0.kind != "compound" }) { row in
                RowView(row: row, send: model.send)
              }
            } header: {
              if let title = section.title { Text(title) }
            } footer: {
              if let footer = section.footer { Text(footer) }
            }
          }
        }
        .formStyle(.grouped)
        // On the pane's own material, not a second background.
        .scrollContentBackground(.hidden)
        .clipped()

        // Settings change as they're made; Cancel puts back what changed since they opened.
        HStack {
          Spacer()
          if let cancel = data.cancel {
            Button(cancel) { model.send(["what": "cancel"]) }.keyboardShortcut(.cancelAction)
          }
          if let confirm = data.confirm {
            Button(confirm) { model.send(["what": "confirm"]) }
              .keyboardShortcut(.defaultAction)
              .disabled(data.confirmDisabled == true)
          }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
      }
      // A different form starts afresh.
      .id(data.key)
    }
  }
}
