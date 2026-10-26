// Why a cell's draft wasn't saved (D42), in a popover of the system's
// pointing at the cell while it's still being edited: the reason, and a
// value to use instead where there is one. It doesn't take the keyboard,
// so typing goes on in the cell, and it stays until the views close it
// (the draft changes, or the edit ends). src/index.tsx's MacCellProblem
// opens it.

import AppKit
import SwiftUI

@objc(TableProblemNote)
public final class TableProblemNote: NSObject {
  @objc public static let shared = TableProblemNote()

  private var popover: NSPopover?

  /// Show `message` pointing at `rect` in `view`; `suggestion`, when given,
  /// is a button's title, and `use` hears it clicked. `confirmable`: asked,
  /// not refused.
  @objc public func show(message: String, confirmable: Bool, suggestion: String?, rect: NSRect, in view: NSView, use: @escaping () -> Void) {
    close()
    let note = ProblemNote(message: message, confirmable: confirmable, suggestion: suggestion, use: use)
    let host = NSHostingController(rootView: note)
    host.sizingOptions = .preferredContentSize
    let popover = NSPopover()
    popover.contentViewController = host
    // Closed by the views, not by a click elsewhere: the cell is still being typed in.
    popover.behavior = .applicationDefined
    self.popover = popover
    popover.show(relativeTo: rect, of: view, preferredEdge: .maxY)
  }

  @objc public func close() {
    popover?.close()
    popover = nil
  }
}

private struct ProblemNote: View {
  let message: String
  let confirmable: Bool
  let suggestion: String?
  let use: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label {
        Text(message).fixedSize(horizontal: false, vertical: true)
      } icon: {
        Image(systemName: confirmable ? "questionmark.circle" : "exclamationmark.triangle")
          .foregroundStyle(confirmable ? Color.secondary : Color.orange)
      }
      if let suggestion {
        Button(suggestion, action: use)
      }
    }
    .frame(maxWidth: 300, alignment: .leading)
    .padding(12)
  }
}
