import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

/// A stretch of the text to colour: UTF-16 offsets, as JavaScript counts.
struct FormulaSpan: Record {
  @Field var start: Int = 0
  @Field var end: Int = 0
  /// `ref`, `fn`, `str`, `num` or `op`.
  @Field var kind: String = ""
}

final class FormulaFieldProps: UIBaseViewProps {
  @Field var defaultValue: String = ""
  @Field var autoFocus: Bool = false
  /// The colouring, and the text it was worked out for: spans for older text are ignored.
  @Field var spans: [FormulaSpan] = []
  @Field var spansFor: String = ""
  @Field var fontSize: Double = 15
  /// Lines the field holds open even when it has fewer (the expanded bar).
  @Field var minLines: Int = 1
  /// Lines it grows to before it scrolls.
  @Field var maxLines: Int = 5
  var onValueChange = EventDispatcher()
  var onSelectionChange = EventDispatcher()
  /// Return: a formula never takes a new line.
  var onSubmit = EventDispatcher()
}

/// Held by reference, so the view's async functions reach the same text view.
final class FormulaFieldModel: ObservableObject {
  weak var textView: UITextView?
  /// The colouring last drawn, kept in step with each edit until the host's
  /// colouring for the new text arrives (a frame later): colour never drops out.
  var spans: [(NSRange, String)] = []
  /// Bumped on every edit, so SwiftUI measures the field again as it grows.
  @Published var revision = 0
}

struct FormulaFieldView: ExpoSwiftUI.View, ExpoSwiftUI.FocusableView {
  @ObservedObject var props: FormulaFieldProps
  @ObservedObject var model: FormulaFieldModel = FormulaFieldModel()

  init(props: FormulaFieldProps) {
    self.props = props
  }

  var body: some View {
    FormulaTextView(props: props, model: model)
  }

  func setText(_ text: String) {
    guard let tv = model.textView else { return }
    tv.text = text
    FormulaTextView.colour(tv, props: props, model: model)
    model.revision += 1
  }

  func setSelection(start: Int, end: Int) {
    guard let tv = model.textView else { return }
    let length = (tv.text as NSString).length
    let lower = max(0, min(start, end, length))
    let upper = max(lower, min(max(start, end), length))
    tv.selectedRange = NSRange(location: lower, length: upper - lower)
  }

  func focus() {
    model.textView?.becomeFirstResponder()
  }

  func forceResignFirstResponder() {
    model.textView?.resignFirstResponder()
  }
}

struct FormulaTextView: UIViewRepresentable {
  @ObservedObject var props: FormulaFieldProps
  @ObservedObject var model: FormulaFieldModel

  func makeCoordinator() -> Coordinator {
    Coordinator(props: props, model: model)
  }

  func makeUIView(context: Context) -> UITextView {
    let tv = UITextView()
    tv.backgroundColor = .clear
    tv.isScrollEnabled = false
    tv.textContainerInset = .zero
    tv.textContainer.lineFragmentPadding = 0
    // Code, not prose: no corrections, capitals, smart punctuation or suggestions.
    tv.autocorrectionType = .no
    tv.autocapitalizationType = .none
    tv.spellCheckingType = .no
    tv.smartQuotesType = .no
    tv.smartDashesType = .no
    tv.smartInsertDeleteType = .no
    tv.inlinePredictionType = .no
    tv.returnKeyType = .done
    tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    tv.delegate = context.coordinator
    tv.text = props.defaultValue
    model.textView = tv
    FormulaTextView.colour(tv, props: props, model: model)
    if props.autoFocus {
      DispatchQueue.main.async {
        tv.becomeFirstResponder()
        tv.selectedRange = NSRange(location: (tv.text as NSString).length, length: 0)
      }
    }
    return tv
  }

  func updateUIView(_ tv: UITextView, context: Context) {
    context.coordinator.props = props
    FormulaTextView.colour(tv, props: props, model: model)
  }

  func sizeThatFits(_ proposal: ProposedViewSize, uiView tv: UITextView, context: Context) -> CGSize? {
    guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
    let line = FormulaTextView.font(props).lineHeight
    let fits = tv.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
    let lowest = line * CGFloat(max(props.minLines, 1))
    let highest = line * CGFloat(max(props.maxLines, props.minLines, 1))
    let scrolls = fits > highest + 0.5
    if tv.isScrollEnabled != scrolls {
      DispatchQueue.main.async { tv.isScrollEnabled = scrolls }
    }
    return CGSize(width: width, height: ceil(min(max(fits, lowest), highest)))
  }

  static func font(_ props: FormulaFieldProps) -> UIFont {
    UIFont.monospacedSystemFont(ofSize: CGFloat(props.fontSize), weight: .regular)
  }

  /// Colour the text from the spans, leaving the characters, the cursor and
  /// any text still being composed (marked text) alone.
  static func colour(_ tv: UITextView, props: FormulaFieldProps, model: FormulaFieldModel) {
    guard tv.markedTextRange == nil else { return }
    let text = tv.text ?? ""
    let length = (text as NSString).length
    let plain: [NSAttributedString.Key: Any] = [.font: font(props), .foregroundColor: UIColor.label]
    let selection = tv.selectedRange
    let storage = tv.textStorage
    storage.beginEditing()
    storage.setAttributes(plain, range: NSRange(location: 0, length: length))
    // The host's colouring when it is for this text; until it is, the last
    // colouring, moved along with the edits since.
    if props.spansFor == text {
      model.spans = props.spans.map { (NSRange(location: $0.start, length: $0.end - $0.start), $0.kind) }
    }
    for (range, kind) in model.spans where range.location >= 0 && range.length > 0 && NSMaxRange(range) <= length {
      storage.addAttribute(.foregroundColor, value: colour(of: kind), range: range)
    }
    storage.endEditing()
    tv.selectedRange = selection
    // What's typed next starts plain, never in the colour of the token before it.
    tv.typingAttributes = plain
  }

  /// Moves coloured ranges along with an edit, knowing nothing of what they
  /// colour: ranges after the edit shift, a range the edit falls inside or at
  /// the end of grows or shrinks with it, and a range the edit removes goes.
  static func shift(_ spans: [(NSRange, String)], replacing edit: NSRange, with inserted: Int) -> [(NSRange, String)] {
    let delta = inserted - edit.length
    let editEnd = NSMaxRange(edit)
    return spans.compactMap { (range, kind) in
      let end = NSMaxRange(range)
      if end < edit.location { return (range, kind) }
      if range.location >= editEnd {
        return (NSRange(location: range.location + delta, length: range.length), kind)
      }
      if edit.location >= range.location && editEnd <= end {
        // Inside the range, or typed at its end: it takes the change.
        let length = range.length + delta
        return length > 0 ? (NSRange(location: range.location, length: length), kind) : nil
      }
      // Partly removed: keep what's left before the edit.
      let kept = edit.location - range.location
      return kept > 0 ? (NSRange(location: range.location, length: kept), kind) : nil
    }
  }

  static func colour(of kind: String) -> UIColor {
    switch kind {
    case "ref": return .systemBlue
    case "fn": return .systemPurple
    case "str": return .systemGreen
    case "num": return .systemOrange
    case "op": return .secondaryLabel
    default: return .label
    }
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    var props: FormulaFieldProps
    let model: FormulaFieldModel

    init(props: FormulaFieldProps, model: FormulaFieldModel) {
      self.props = props
      self.model = model
    }

    func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
      if text == "\n" {
        props.onSubmit(["value": tv.text ?? ""])
        return false
      }
      model.spans = FormulaTextView.shift(model.spans, replacing: range, with: (text as NSString).length)
      return true
    }

    func textViewDidChange(_ tv: UITextView) {
      FormulaTextView.colour(tv, props: props, model: model)
      props.onValueChange(["value": tv.text ?? ""])
      model.revision += 1
    }

    func textViewDidChangeSelection(_ tv: UITextView) {
      let range = tv.selectedRange
      props.onSelectionChange(["start": range.location, "end": range.location + range.length])
    }
  }
}

