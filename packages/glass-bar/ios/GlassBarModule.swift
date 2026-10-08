import ExpoModulesCore
import ExpoUI

/// The glass bar's native pieces. For now, one: a formula field whose
/// references, functions, strings and numbers are coloured as they are typed,
/// which Expo UI's TextField (plain text only) cannot do.
public class GlassBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlassBar")

    // Registered as an Expo UI view, so it can sit inside a Host's SwiftUI
    // tree and take the same modifiers (padding, frame, glass) as Expo UI's own.
    ExpoUIView(FormulaFieldView.self) {
      AsyncFunction("setText") { (view: FormulaFieldView, text: String) in
        view.setText(text)
      }
      AsyncFunction("setSelection") { (view: FormulaFieldView, start: Int, end: Int) in
        view.setSelection(start: start, end: end)
      }
      AsyncFunction("focus") { (view: FormulaFieldView) in
        view.focus()
      }
      AsyncFunction("blur") { (view: FormulaFieldView) in
        view.forceResignFirstResponder()
      }
    }
  }
}
