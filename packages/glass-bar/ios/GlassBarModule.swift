import ExpoModulesCore
import ExpoUI
import UIKit

/// The glass bar's native pieces: a formula field whose references,
/// functions, strings and numbers are coloured as they are typed, which Expo
/// UI's TextField (plain text only) cannot do; and Light and Dark kept in
/// step with the system for any app that uses the bar.
public class GlassBarModule: Module {
  private var activeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("GlassBar")

    // React Native ignores Light/Dark changes made while the app is in the
    // background (RCTSurfaceHostingView), and doesn't look again when it
    // comes back: switched at sunset with the app away, its colour scheme
    // stayed Light while the system's own views were Dark (or the other way
    // round), so what it styles came back in the wrong one: light text on a
    // light table. Told the window's style each time the app is active
    // again; React Native passes it on only when it changed.
    OnCreate {
      self.activeObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { _ in
        let window = UIApplication.shared.connectedScenes
          .compactMap { $0 as? UIWindowScene }
          .flatMap(\.windows)
          .first(where: \.isKeyWindow)
        guard let traits = window?.traitCollection else { return }
        NotificationCenter.default.post(
          name: Notification.Name("RCTUserInterfaceStyleDidChangeNotification"),
          object: nil,
          userInfo: ["traitCollection": traits]
        )
      }
    }

    OnDestroy {
      if let observer = self.activeObserver { NotificationCenter.default.removeObserver(observer) }
    }

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
