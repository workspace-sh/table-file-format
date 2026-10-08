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
    FormulaTextView.colour(tv, props: props)
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
    FormulaTextView.colour(tv, props: props)
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
    FormulaTextView.colour(tv, props: props)
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
  static func colour(_ tv: UITextView, props: FormulaFieldProps) {
    guard tv.markedTextRange == nil else { return }
    let text = tv.text ?? ""
    let length = (text as NSString).length
    let plain: [NSAttributedString.Key: Any] = [.font: font(props), .foregroundColor: UIColor.label]
    let selection = tv.selectedRange
    let storage = tv.textStorage
    storage.beginEditing()
    storage.setAttributes(plain, range: NSRange(location: 0, length: length))
    // The host's colouring when it is for this text; otherwise the field's
    // own, worked out here on the keystroke so colour never lags the typing.
    let spans: [(NSRange, String)] = props.spansFor == text && !props.spans.isEmpty
      ? props.spans.map { (NSRange(location: $0.start, length: $0.end - $0.start), $0.kind) }
      : FormulaScanner.spans(text)
    for (range, kind) in spans where range.location >= 0 && range.length > 0 && NSMaxRange(range) <= length {
      storage.addAttribute(.foregroundColor, value: colour(of: kind), range: range)
    }
    storage.endEditing()
    tv.selectedRange = selection
    // What's typed next starts plain, never in the colour of the token before it.
    tv.typingAttributes = plain
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
      return true
    }

    func textViewDidChange(_ tv: UITextView) {
      FormulaTextView.colour(tv, props: props)
      props.onValueChange(["value": tv.text ?? ""])
      model.revision += 1
    }

    func textViewDidChangeSelection(_ tv: UITextView) {
      let range = tv.selectedRange
      props.onSelectionChange(["start": range.location, "end": range.location + range.length])
    }
  }
}

/// Where a formula's colours go. Core's TypeScript `formulaSpans` is the
/// source of these rules and runs on every platform; this mirror exists only
/// so a native text field can colour on the keystroke. Both are checked
/// against packages/core/src/formulaSpans.cases.json
/// (scripts/check-formula-spans.sh). Never refuses: a half-typed formula
/// colours up to where it stops. Ranges are UTF-16, as UIKit and JavaScript count.
enum FormulaScanner {
  private static let ops = ["<=", ">=", "<>", "!=", "==", "=", "<", ">", "+", "-", "*", "/", "&", "(", ")", ",", ":", "^", "%"]
    .map { Array($0.unicodeScalars) }

  static func spans(_ text: String) -> [(NSRange, String)] {
    let s = Array(text.unicodeScalars)
    var at = [Int]()
    var o = 0
    for c in s { at.append(o); o += c.utf16.count }
    at.append(o)
    var out: [(NSRange, String)] = []
    func add(_ a: Int, _ b: Int, _ kind: String) {
      out.append((NSRange(location: at[a], length: at[b] - at[a]), kind))
    }
    func digit(_ i: Int) -> Bool { i < s.count && s[i].value >= 48 && s[i].value <= 57 }
    func identStart(_ c: Unicode.Scalar) -> Bool { CharacterSet.letters.contains(c) || c == "_" || c == "$" }
    func identPart(_ c: Unicode.Scalar) -> Bool { CharacterSet.alphanumerics.contains(c) || c == "_" || c == "$" }
    // Up to the closing `close` (a doubled quote escapes one), or the end.
    func closing(_ from: Int, _ close: Unicode.Scalar) -> Int {
      var j = from + 1
      while j < s.count {
        if s[j] == close {
          if close != "]" && close != "}" && j + 1 < s.count && s[j + 1] == close { j += 2; continue }
          return j + 1
        }
        j += 1
      }
      return s.count
    }
    var i = 0
    while i < s.count {
      let c = s[i]
      if CharacterSet.whitespacesAndNewlines.contains(c) { i += 1; continue }
      if c == "\"" {
        let end = closing(i, "\"")
        add(i, end, "str"); i = end; continue
      }
      if c == "{" || c == "[" || c == "'" {
        var end = closing(i, c == "{" ? "}" : c == "[" ? "]" : "'")
        if c == "'" && end < s.count && s[end] == "!" {
          end += 1
          while end < s.count && identPart(s[end]) { end += 1 }
        }
        add(i, end, "ref"); i = end; continue
      }
      if digit(i) || (c == "." && digit(i + 1)) {
        var j = i
        while digit(j) { j += 1 }
        if j < s.count && s[j] == "." { j += 1; while digit(j) { j += 1 } }
        if j < s.count && (s[j] == "e" || s[j] == "E") {
          var k = j + 1
          if k < s.count && (s[k] == "+" || s[k] == "-") { k += 1 }
          if digit(k) { j = k; while digit(j) { j += 1 } }
        }
        add(i, j, "num"); i = j; continue
      }
      if identStart(c) {
        var j = i + 1
        while j < s.count && identPart(s[j]) { j += 1 }
        var after = j
        while after < s.count && s[after] == " " { after += 1 }
        let word = String(String.UnicodeScalarView(s[i..<j])).lowercased()
        let kind = after < s.count && s[after] == "(" ? "fn" : ["true", "false", "nil"].contains(word) ? "num" : "ref"
        add(i, j, kind); i = j; continue
      }
      if let op = ops.first(where: { op in i + op.count <= s.count && Array(s[i..<(i + op.count)]) == op }) {
        add(i, i + op.count, "op"); i += op.count; continue
      }
      i += 1
    }
    return out
  }
}
