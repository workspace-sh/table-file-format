// A date, a time, or both, chosen in the system's date picker, in a
// popover that points at the table cell it's for: what Reminders and
// Calendar show for a date on a Mac. A day clicked in the calendar is the
// answer for a date alone; a time (and a date with a time) is the answer
// when the popover is closed, since a time takes several steps to set.

import AppKit

@objc(TableDatePicker)
public final class TableDatePicker: NSObject, NSPopoverDelegate {
  @objc public static let shared = TableDatePicker()

  private var popover: NSPopover?
  /// The day's picker and the time's: either, or both for a date and time.
  private var pickers: [NSDatePicker] = []
  private var began = Date()
  private var dateOnly = true
  private var done: ((NSNumber?) -> Void)?

  /// Show the picker for `kind` ("date", "time" or "datetime") at `date`
  /// (now when there's none), pointing at `rect` of `view`. `done` gets
  /// the date chosen, as milliseconds since 1970, or nil when it's closed
  /// with nothing changed.
  @objc public func show(kind: String, date: NSNumber?, rect: NSRect, in view: NSView, done: @escaping (NSNumber?) -> Void) {
    // One already open (for another cell) answers first.
    if let open = popover {
      open.delegate = nil
      open.close()
      finish()
    }
    began = date.map { Date(timeIntervalSince1970: $0.doubleValue / 1000) } ?? Date()
    // A calendar for the day; a field with a stepper for the time, which a
    // clock face can't be typed into. A date and time has both, the time
    // under the calendar, as Reminders has them.
    let make = { (style: NSDatePicker.Style, elements: NSDatePicker.ElementFlags) -> NSDatePicker in
      let picker = NSDatePicker()
      picker.datePickerMode = .single
      picker.isBezeled = style == .textFieldAndStepper
      picker.drawsBackground = style == .textFieldAndStepper
      // The popover already says where the keyboard is.
      picker.focusRingType = .none
      picker.datePickerStyle = style
      picker.datePickerElements = elements
      picker.dateValue = self.began
      picker.target = self
      picker.action = #selector(self.changed(_:))
      picker.sizeToFit()
      return picker
    }
    let day = kind == "time" ? nil : make(.clockAndCalendar, [.yearMonthDay])
    let time = kind == "date" ? nil : make(.textFieldAndStepper, [.hourMinute])
    // AppKit's calendar comes at one fixed, small size. It's drawn a quarter as large again here by giving
    // its holder a frame 1.25 times its bounds: AppKit redraws it at that size, crisply, and maps clicks
    // back. The time field keeps the system's size.
    let scale: CGFloat = 1.25
    var parts: [NSView] = []
    if let day {
      let size = day.frame.size
      let scaled = NSView(frame: NSRect(x: 0, y: 0, width: size.width * scale, height: size.height * scale))
      scaled.bounds = NSRect(origin: .zero, size: size)
      day.frame = NSRect(origin: .zero, size: size)
      scaled.addSubview(day)
      parts.append(scaled)
    }
    if let time { parts.append(time) }
    // Top to bottom in a holder whose y runs up: the calendar first, the time under it.
    let spacing: CGFloat = 10
    let margin: CGFloat = 14
    let width = parts.map(\.frame.width).max() ?? 0
    let height = parts.map(\.frame.height).reduce(0, +) + spacing * CGFloat(max(parts.count - 1, 0))
    let holder = NSView(frame: NSRect(x: 0, y: 0, width: width + margin * 2, height: height + margin * 2))
    var top = margin + height
    for part in parts {
      top -= part.frame.height
      part.setFrameOrigin(NSPoint(x: margin + (width - part.frame.width) / 2, y: top))
      top -= spacing
      holder.addSubview(part)
    }
    let controller = NSViewController()
    controller.view = holder

    let popover = NSPopover()
    popover.contentViewController = controller
    popover.contentSize = holder.frame.size
    popover.behavior = .transient
    popover.delegate = self
    self.popover = popover
    pickers = [day, time].compactMap { $0 }
    self.done = done
    dateOnly = kind == "date"
    // A new date with no value yet: closing on today's date still means today.
    if date == nil { began = .distantPast }
    popover.show(relativeTo: rect, of: view, preferredEdge: .maxY)
  }

  @objc private func changed(_ sender: NSDatePicker) {
    // One date between them: the day picked keeps its time, the time set keeps its day.
    for other in pickers where other !== sender { other.dateValue = sender.dateValue }
    // A day clicked is the whole answer for a date alone.
    if dateOnly { close() }
  }

  /// Close the picker, answering with what it holds if that changed.
  @objc public func close() {
    popover?.close()
  }

  public func popoverDidClose(_ notification: Notification) {
    finish()
  }

  private func finish() {
    guard let picker = pickers.first, let done = done else { return }
    let chosen = picker.dateValue
    self.done = nil
    pickers = []
    popover = nil
    done(chosen == began ? nil : NSNumber(value: (chosen.timeIntervalSince1970 * 1000).rounded()))
  }

  /// Development only: whether the picker is showing; and set its date
  /// (milliseconds since 1970) as a click in it would.
  @objc public var isShown: Bool { popover?.isShown ?? false }
  @objc public func set(date: NSNumber) {
    guard let picker = pickers.last else { return }
    picker.dateValue = Date(timeIntervalSince1970: date.doubleValue / 1000)
    changed(picker)
  }
}
