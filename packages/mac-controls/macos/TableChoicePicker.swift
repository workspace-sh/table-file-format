// Several choices from a list (a multi-select's tags, a link to several
// rows) in a popover of the system's pointing at the cell: each choice
// with its tick and its tag, toggled as it's clicked, the list staying
// open until a click outside, Escape or Return. It's a quick choice, so a
// popover, not the inspector. src/index.tsx's MacChooseMany opens it.
//
// One choice (MacSelect) is the same list, so a choice looks the same
// whichever kind of field it is: its tags and its tick, and a click that
// picks it and closes.

import AppKit
import SwiftUI

@objc(TableChoicePicker)
public final class TableChoicePicker: NSObject, NSPopoverDelegate {
  @objc public static let shared = TableChoicePicker()

  private var popover: NSPopover?
  private var done: (() -> Void)?

  /// Show `options` ({ value, label, color? }) with `selected` ticked, pointing at
  /// `rect` in `view`. `toggled` hears each pick; `done` the popover closing.
  @objc public func show(
    options: [[String: Any]],
    selected: [String],
    rect: NSRect,
    in view: NSView,
    toggled: @escaping (String) -> Void,
    done: @escaping () -> Void
  ) {
    present(options: options, selected: selected, rect: rect, in: view, single: false, toggled: toggled, done: done)
  }

  /// One of `options`, `selected` ticked: a click picks it (`chosen`) and closes.
  @objc public func showOne(
    options: [[String: Any]],
    selected: String?,
    rect: NSRect,
    in view: NSView,
    chosen: @escaping (String) -> Void,
    done: @escaping () -> Void
  ) {
    present(options: options, selected: selected.map { [$0] } ?? [], rect: rect, in: view, single: true, toggled: chosen, done: done)
  }

  private func present(
    options: [[String: Any]],
    selected: [String],
    rect: NSRect,
    in view: NSView,
    single: Bool,
    toggled: @escaping (String) -> Void,
    done: @escaping () -> Void
  ) {
    close()
    let model = ChoicesModel(
      options: options.compactMap { o in
        guard let value = o["value"] as? String else { return nil }
        return Choice(value: value, label: o["label"] as? String ?? value, color: o["color"] as? String)
      },
      selected: Set(selected),
      single: single
    )
    model.toggled = toggled
    let popover = NSPopover()
    let host = NSHostingController(rootView: ChoicesList(model: model, close: { [weak self] in self?.close() }))
    if single { model.picked = { [weak self] in self?.close() } }
    host.sizingOptions = .preferredContentSize
    popover.contentViewController = host
    popover.behavior = .transient
    popover.delegate = self
    self.popover = popover
    self.done = done
    popover.show(relativeTo: rect, of: view, preferredEdge: .maxY)
    // The keyboard to the list, as a menu takes it when it opens: up, down,
    // Space, Return and Escape are its, not the table's under it.
    host.view.window?.makeKey()
  }

  @objc public func close() {
    popover?.close()
  }

  public func popoverDidClose(_ notification: Notification) {
    popover = nil
    let done = self.done
    self.done = nil
    done?()
  }

  @objc public var isShown: Bool { popover?.isShown ?? false }
}

private struct Choice: Identifiable, Equatable {
  let value: String
  let label: String
  let color: String?
  var id: String { value }
}

private final class ChoicesModel: ObservableObject {
  let options: [Choice]
  @Published var selected: Set<String>
  /// One choice: a click picks it and the list closes.
  let single: Bool
  var toggled: (String) -> Void = { _ in }
  var picked: () -> Void = {}

  init(options: [Choice], selected: Set<String>, single: Bool = false) {
    self.options = options
    self.selected = selected
    self.single = single
  }

  func toggle(_ value: String) {
    if single {
      selected = [value]
      toggled(value)
      picked()
      return
    }
    if selected.contains(value) { selected.remove(value) } else { selected.insert(value) }
    toggled(value)
  }
}

private struct ChoicesList: View {
  @ObservedObject var model: ChoicesModel
  let close: () -> Void
  @State private var focused: String?
  @FocusState private var hasKeyboard: Bool

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 2) {
        ForEach(model.options) { choice in
          let on = model.selected.contains(choice.value)
          Button {
            focused = choice.value
            model.toggle(choice.value)
          } label: {
            HStack(spacing: 8) {
              Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .semibold))
                .opacity(on ? 1 : 0)
                .frame(width: 14)
              Tag(choice: choice)
              Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
            // The row under the pointer, or the keyboard's: a neutral wash, as
            // a list's hover is, which leaves each tag its own colour. The
            // chosen one is its tick.
            .background(
              RoundedRectangle(cornerRadius: 6)
                .fill(focused == choice.value ? Color.primary.opacity(0.07) : .clear)
            )
          }
          .buttonStyle(.plain)
          .onHover { inside in if inside { focused = choice.value } }
          .accessibilityAddTraits(on ? .isSelected : [])
        }
      }
      .padding(6)
    }
    .frame(minWidth: 180, idealWidth: 220, maxWidth: 320, maxHeight: 360)
    // The popover's own glass lets the table under it show through the
    // tags; a thicker material behind the list keeps them on one ground.
    .background(.thickMaterial)
    .fixedSize(horizontal: false, vertical: true)
    // The keyboard, as a menu's: up and down move, Space toggles, Return and Escape close.
    .focusable()
    .focused($hasKeyboard)
    .focusEffectDisabled()
    .onKeyPress(.downArrow) { move(1); return .handled }
    .onKeyPress(.upArrow) { move(-1); return .handled }
    .onKeyPress(.space) {
      if let focused { model.toggle(focused) }
      return .handled
    }
    // Return picks the highlighted one in a list of one choice, and closes a list of several.
    .onKeyPress(.return) {
      if model.single, let focused { model.toggle(focused) } else { close() }
      return .handled
    }
    .onKeyPress(.escape) { close(); return .handled }
    // On the chosen one, when there is one, as a pop-up menu opens on its tick.
    .onAppear {
      focused = model.options.first { model.selected.contains($0.value) }?.value ?? model.options.first?.value
      hasKeyboard = true
    }
  }

  private func move(_ by: Int) {
    let values = model.options.map(\.value)
    guard !values.isEmpty else { return }
    let at = focused.flatMap { values.firstIndex(of: $0) } ?? -1
    focused = values[max(0, min(values.count - 1, at + by))]
  }
}

/// A choice's tag: its label on its colour, as the table draws it.
private struct Tag: View {
  let choice: Choice

  var body: some View {
    let tint = colour(choice.color)
    if choice.value.isEmpty {
      // No choice: its word, not a tag.
      Text(choice.label)
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .padding(.vertical, 2)
    } else {
      Text(choice.label)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(choice.color == nil ? Color.primary : tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(Capsule().fill(tint.opacity(choice.color == nil ? 0.12 : 0.22)))
    }
  }

  /// The table's choice colours (EnumColor) as the system's.
  private func colour(_ name: String?) -> Color {
    switch name {
    case "gray": return .gray
    case "brown": return .brown
    case "red": return .red
    case "orange": return .orange
    case "yellow": return .yellow
    case "lime": return Color(red: 0.55, green: 0.78, blue: 0.2)
    case "green": return .green
    case "mint": return .mint
    case "teal": return .teal
    case "cyan": return .cyan
    case "blue": return .blue
    case "indigo": return .indigo
    case "purple": return .purple
    case "pink": return .pink
    default: return .secondary
    }
  }
}

// MARK: A calendar's controls

private final class CalendarControlsModel: ObservableObject {
  @Published var range = "month"
  @Published var canPrevious = true
  @Published var canNext = true
  @Published var canToday = true
  var send: (String) -> Void = { _ in }
}

private struct CalendarControlsContent: View {
  @ObservedObject var model: CalendarControlsModel

  var body: some View {
    HStack(spacing: 10) {
      Spacer(minLength: 0)
      Picker("Range", selection: Binding(get: { model.range }, set: { model.send($0) })) {
        Text("Month").tag("month")
        Text("Week").tag("week")
        Text("Agenda").tag("agenda")
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .fixedSize()
      ControlGroup {
        Button { model.send("previous") } label: { Label("Previous", systemImage: "chevron.backward") }
          .disabled(!model.canPrevious)
        Button("Today") { model.send("today") }
          .disabled(!model.canToday)
        Button { model.send("next") } label: { Label("Next", systemImage: "chevron.forward") }
          .disabled(!model.canNext)
      }
      .labelStyle(.iconOnly)
      .fixedSize()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// The range as the system's segmented control, and Previous, Today and
/// Next as its button group. Drawn by SwiftUI and told what to show by React.
@objc(TableCalendarControlsView)
public final class TableCalendarControlsView: NSView {
  private let model = CalendarControlsModel()

  @objc public var selectedRange: String = "month" { didSet { model.range = selectedRange } }
  @objc public var canPrevious: Bool = true { didSet { model.canPrevious = canPrevious } }
  @objc public var canNext: Bool = true { didSet { model.canNext = canNext } }
  @objc public var canToday: Bool = true { didSet { model.canToday = canToday } }
  @objc public var onCommand: (([AnyHashable: Any]?) -> Void)?

  public override init(frame: NSRect) {
    super.init(frame: frame)
    model.send = { [weak self] command in self?.onCommand?(["command": command]) }
    let host = NSHostingView(rootView: CalendarControlsContent(model: model))
    host.sizingOptions = []
    host.frame = bounds
    host.autoresizingMask = [.width, .height]
    addSubview(host)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}
