// A formula being written, in the inspector: the system's grouped form
// around the system's text view. The formula is in one field, in its
// colours, wrapping as it grows; under it its operators, what's wrong with
// it or how it's worked out for this row, and the buttons that end the
// edit. Return saves and Escape cancels, as in the cell.
//
// What it says is the app's (glass-bar's editor state, the one the iOS bar
// shows), sent as JSON; what's typed and pressed goes back as events, and
// the app answers each change with the colours and working for the new
// text.

import AppKit
import SwiftUI

struct FormulaEditorData: Decodable, Equatable {
  struct Span: Decodable, Equatable {
    var start: Int
    var end: Int
    /// "ref", "fn", "str", "num" or "op".
    var kind: String
  }
  struct Row: Decodable, Equatable {
    var label: String
    var value: String
    var strong: Bool?
  }
  struct Working: Decodable, Equatable {
    var title: String?
    var rows: [Row]
  }
  struct Chip: Decodable, Equatable {
    var id: String
    var label: String
    /// Put in at the cursor when pressed, the cursor then `cursorBack` characters back.
    var insert: String?
    var cursorBack: Int?
  }
  struct Problem: Decodable, Equatable {
    var message: String
    var fixLabel: String?
  }

  /// One per edit: a new key starts the field again from `initialValue`.
  var key: String
  var label: String
  var detail: String?
  var initialValue: String
  /// The text `spans` were worked out for; colours for any other text are stale and not drawn.
  var text: String
  var spans: [Span]
  var working: [Working]
  var chips: [Chip]
  var error: Problem?
  var cancelLabel: String
  var saveLabel: String
  /// Absent where the schema can't be edited.
  var settingsLabel: String?
}

final class TableFormulaEditorModel: NSObject, ObservableObject, NSTextViewDelegate {
  @Published var data: FormulaEditorData? {
    didSet {
      guard let data else { return }
      if data.key != oldValue?.key { start(data) }
      colour(with: data)
    }
  }
  /// Goes up as the text changes, so the form asks the field its height again.
  @Published var revision = 0
  /// What was typed or pressed: `what` and, with it, `text` or `id`.
  var send: ([String: Any]) -> Void = { _ in }

  /// The formula's field: the system's text view, plain text in one
  /// monospaced size, its parts coloured over the text (so the colours are
  /// never part of what's typed, copied or undone). One for the editor's
  /// life: each edit starts it again.
  let textView: NSTextView = {
    let view = NSTextView()
    view.isRichText = false
    view.allowsUndo = true
    view.font = .monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    view.textColor = .labelColor
    view.drawsBackground = false
    view.textContainerInset = NSSize(width: 0, height: 4)
    view.textContainer?.lineFragmentPadding = 0
    view.textContainer?.widthTracksTextView = true
    view.isVerticallyResizable = true
    view.isHorizontallyResizable = false
    // A formula is typed as it is: no curled quotes, long dashes or corrections.
    view.isAutomaticQuoteSubstitutionEnabled = false
    view.isAutomaticDashSubstitutionEnabled = false
    view.isAutomaticTextReplacementEnabled = false
    view.isAutomaticSpellingCorrectionEnabled = false
    view.isContinuousSpellCheckingEnabled = false
    view.isGrammarCheckingEnabled = false
    view.isAutomaticTextCompletionEnabled = false
    return view
  }()

  override init() {
    super.init()
    textView.delegate = self
  }

  /// A new edit: the field holds the formula as it stands, the cursor at its end, and has the keyboard.
  private func start(_ data: FormulaEditorData) {
    textView.string = data.initialValue
    textView.undoManager?.removeAllActions()
    textView.setSelectedRange(NSRange(location: (data.initialValue as NSString).length, length: 0))
    revision += 1
    // Once the form has it in the window.
    DispatchQueue.main.async { [textView] in textView.window?.makeFirstResponder(textView) }
  }

  /// Put `text` in at the cursor (an operator, or a clicked column's name) and step back.
  func insert(_ text: String, cursorBack: Int = 0) {
    textView.window?.makeFirstResponder(textView)
    textView.insertText(text, replacementRange: textView.selectedRange())
    if cursorBack > 0 {
      let at = max(0, textView.selectedRange().location - cursorBack)
      textView.setSelectedRange(NSRange(location: at, length: 0))
    }
  }

  /// Development only: replace the whole formula, as selecting it all and typing would.
  func type(_ text: String) {
    textView.window?.makeFirstResponder(textView)
    textView.insertText(text, replacementRange: NSRange(location: 0, length: (textView.string as NSString).length))
  }

  func textDidChange(_ notification: Notification) {
    // The old colours are for the old text: gone until the app sends the new ones.
    textView.layoutManager?.removeTemporaryAttribute(.foregroundColor, forCharacterRange: NSRange(location: 0, length: (textView.string as NSString).length))
    revision += 1
    send(["what": "change", "text": textView.string])
  }

  func textView(_ view: NSTextView, doCommandBy selector: Selector) -> Bool {
    if selector == #selector(NSResponder.insertNewline(_:)) {
      send(["what": "submit", "text": view.string])
      return true
    }
    if selector == #selector(NSResponder.cancelOperation(_:)) {
      send(["what": "cancel"])
      return true
    }
    return false
  }

  private func colour(with data: FormulaEditorData) {
    guard let layout = textView.layoutManager, data.text == textView.string else { return }
    let length = (textView.string as NSString).length
    layout.removeTemporaryAttribute(.foregroundColor, forCharacterRange: NSRange(location: 0, length: length))
    for span in data.spans where span.start >= 0 && span.end <= length && span.end > span.start {
      layout.addTemporaryAttribute(.foregroundColor, value: Self.colours[span.kind] ?? NSColor.labelColor, forCharacterRange: NSRange(location: span.start, length: span.end - span.start))
    }
  }

  /// A formula's colours, by what each stretch is: the system's, so they follow the appearance.
  private static let colours: [String: NSColor] = [
    "ref": .systemBlue,
    "fn": .systemPurple,
    "str": .systemRed,
    "num": .systemGreen,
    "op": .secondaryLabelColor,
  ]
}

struct TableFormulaEditorView: View {
  @ObservedObject var model: TableFormulaEditorModel

  var body: some View {
    if let data = model.data {
      Form {
        Section {
          FormulaField(model: model, revision: model.revision)
          if !data.chips.isEmpty {
            HStack(spacing: 6) {
              ForEach(data.chips, id: \.id) { chip in
                Button {
                  if let piece = chip.insert { model.insert(piece, cursorBack: chip.cursorBack ?? 0) }
                  model.send(["what": "chip", "id": chip.id])
                } label: {
                  Text((chip.insert ?? chip.label).trimmingCharacters(in: .whitespaces))
                    .font(.body.monospaced())
                    .frame(minWidth: 14)
                }
                .accessibilityLabel(chip.label)
              }
            }
            .controlSize(.small)
          }
          if let error = data.error {
            VStack(alignment: .leading, spacing: 6) {
              Label(error.message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
              if let fix = error.fixLabel {
                Button(fix) { model.send(["what": "fix"]) }
                  .controlSize(.small)
              }
            }
          }
        } header: {
          Text(data.label)
        } footer: {
          if let detail = data.detail {
            Text(detail)
          }
        }
        ForEach(Array(data.working.enumerated()), id: \.offset) { _, section in
          Section {
            ForEach(Array(section.rows.enumerated()), id: \.offset) { _, row in
              LabeledContent(row.label) {
                Text(row.value)
                  .monospacedDigit()
                  .fontWeight(row.strong == true ? .semibold : .regular)
                  .textSelection(.enabled)
              }
            }
          } header: {
            if let title = section.title {
              Text(title)
            }
          }
        }
        Section {
          if let settings = data.settingsLabel {
            Button(settings) { model.send(["what": "settings"]) }
          }
          HStack {
            Spacer()
            Button(data.cancelLabel) { model.send(["what": "cancel"]) }
            Button(data.saveLabel) { model.send(["what": "save", "text": model.textView.string]) }
              .buttonStyle(.borderedProminent)
              .disabled(data.error != nil)
          }
        }
      }
      .formStyle(.grouped)
      // On the pane's own material, not a second background.
      .scrollContentBackground(.hidden)
    }
  }
}

/// The editor's text view, in the form: as wide as it's given and as tall as its lines.
private struct FormulaField: NSViewRepresentable {
  let model: TableFormulaEditorModel
  /// Read so the form lays the field out again when the text changes.
  let revision: Int

  func makeNSView(context: Context) -> NSTextView {
    model.textView.removeFromSuperview()
    return model.textView
  }

  func updateNSView(_ view: NSTextView, context: Context) {}

  /// Two lines at least.
  func sizeThatFits(_ proposal: ProposedViewSize, nsView view: NSTextView, context: Context) -> CGSize? {
    guard let container = view.textContainer, let layout = view.layoutManager else { return nil }
    let width = max(80, proposal.width ?? 240)
    container.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
    layout.ensureLayout(for: container)
    let line = layout.defaultLineHeight(for: view.font ?? .systemFont(ofSize: NSFont.systemFontSize))
    let height = max(layout.usedRect(for: container).height, line * 2) + view.textContainerInset.height * 2
    return CGSize(width: width, height: ceil(height))
  }
}
