# What is platform-specific

Where `@workspace.sh/table-ui` forks by platform, why, and how a host app
swaps one of its controls for its own.

The five views, the schema editor and the body editor are written once
and run unchanged on web, iOS, Android and macOS. Nothing in the view
layer branches on platform.

Every fork lives in `packages/ui/src/internal/`, and there are twenty-four
of them. Most are a `.web.tsx` or `.web.ts` override beside a default
that serves native; `Tooltip` is a `.macos.tsx` override beside a
default that serves the rest, `useEscape` and `AttachmentImage` have
both, and `RowActions`, `Select`, `DateInput`, `Toggle` and `Sheet` have
`.ios.tsx` and `.android.tsx` beside their other forks:

| Fork | Why it forks |
|---|---|
| `Portal` (with `PortalHost`) | Overlay hosting. RN's `Modal` crashes on macOS, so native uses a context-based host instead of the DOM's `createPortal`. |
| `BottomSheet` | Presentation differs by convention, not just API. |
| `HScroll`, `SnapHScroll`, `Bleed` | Horizontal scrolling, snap points, and running a sideways scroller out to the page's edges. |
| `DragHandle`, `useDropTargets` | Pointer events vs. gesture handlers. |
| `useHoverHint` | A hint when the pointer rests on something. Native adds nothing, since touch screens don't hover. |
| `Tooltip` | The system tooltip for a plain-text hint, on macOS: AppKit's own, through react-native-macos's `tooltip` View prop. Everywhere else it adds nothing, not even an element; the web has its own hover hint. |
| `useEscape` | Escape as a way out (closing an editor with nothing unsaved). The web hears it on the document; macOS from the text input being typed in, which reports it as the escape character; touch screens have no Escape key, so there it adds nothing. |
| `AttachmentImage` | An attachment drawn as an image. React Native's decoders on iOS and Android don't read SVG, so there an `.svg` is drawn by react-native-svg; the web and macOS draw every image themselves (macOS's decoder is patched to hand SVG to NSImage, and react-native-svg draws nothing on react-native-macos under the New Architecture). |
| `measureAnchor`, `useContainerWidth`, `useViewportWidth`, `useViewportHeight` | Layout measurement, which has no shared primitive. |
| `Select` | A choice from a list. The web keeps the browser's own select, with its look, keyboard and accessibility. iOS uses the system's menu (SwiftUI's Picker, from `@expo/ui`), and Android Material's dropdown menu (Compose's); on both, a selected choice cell is itself the menu, so its next tap chooses. macOS, which React Native gives no select, has a button that opens a menu of the options in the `Portal`. |
| `Checkbox` | The web keeps the browser's own checkbox, in a `label` when it has text. React Native has none, so native is a small square that fills with a tick, set in a row beside its text, since a `label` is a Text there. |
| `CellLink` | A link in a cell (an email, a phone number, a web address, an attachment, a related row). The web keeps the browser's link, and a button for a related row. macOS clicks it the same way and has the system open it, since React Strict DOM's `<a>` doesn't follow its `href` on native. A touch screen shows the value as text, so a tap selects the cell and a second edits it (or opens a relation's picker), with a button beside it that opens the link. |
| `Toggle` | On or off. The web and macOS keep their checkbox. On a phone a setting is the system's switch (SwiftUI's Toggle on iOS, Material's Switch on Android), its text before it, and a table cell is a symbol a tap flips (iOS's check circle, Material's check box), since the HIG keeps switches to list rows. |
| `Sheet` | Something edited apart from the view (a row's page). The web and macOS: a card over the page with its buttons along the foot. iOS: the system's page sheet (React Native's Modal, so nothing is hosted in SwiftUI), with Done trailing, swiped away when nothing is lost and otherwise leaving the caller to ask (a page saves as it's typed, and asks only before deleting itself). Android: Material's full-screen dialog. A view's settings (`size: "settings"`) are a form sheet on iOS that opens half way and grows, with a grabber and Done (react-native-screens' formSheet; React Native's Modal has no detents); elsewhere they stay a panel in the page. |
| `DateInput` | A date, time, or date and time picked in a selected cell. iOS: the system's compact date picker (SwiftUI's), opening the calendar or time wheels. Android: Material's date and time dialogs (Compose's). The web and macOS type dates in the cell's editor (the web's own date input), so there it's unavailable. Typing on a selected cell still opens its text editor everywhere, so a typed or pasted date still parses. |
| `systemColors` | The interface's colours. On iOS, each light/dark pair a view writes is swapped at load for the system colour that plays the same role (label, secondary label, separator, system background, system blue and red, link) through PlatformColor, so they follow dark mode and Increase Contrast. The web, macOS and Android keep the palette as written; choice pills are data colours and keep theirs. |
| `inputAttributes` | The keyboard a field wants (`inputHints`). The web keeps the browser's input types (a date picker, a number field). React Native has neither, and React Strict DOM turns `type="number"` into a digits-only pad, so native passes the input mode alone, and sets the keyboard with a minus and a point for a signed number on the TextInput itself. |
| `RowActions` | A row's actions (open its document, insert, delete). The web and macOS: right-click for a menu at the pointer. iOS: touch and hold for the system's context menu (UIKit's `UIContextMenuInteraction` on the row's own view, from react-native-ios-context-menu), lifting a card with the row's title; not @expo/ui's ContextMenu, which hosts the row inside SwiftUI, where hosted rows lost their text. Android: touch and hold for Material's dropdown menu (Compose's, from `@expo/ui`). |

The pattern is worth stating plainly: the forks are **scrolling,
dragging, measuring, overlays and the two form controls React Native
lacks**: the things no cross-platform
abstraction unifies, because they are where platforms genuinely differ.
Feature code does not fork. If a new fork appears outside
`internal/`, that is a signal worth examining rather than a routine
cost.

## Overriding a control

Where a fork is a control (`RowActions`, `Select`, `DateInput`, `Toggle` and `Sheet` so far), table-ui draws the
platform's own by default, and a host app can pass its own instead:

```tsx
import { PlatformControlsProvider } from "@workspace.sh/table-ui";
import type { RowActionsProps } from "@workspace.sh/table-ui/shared";

function MyRowMenu({ actions, children }: RowActionsProps) {
  // `children` is the row; `actions` are what can be done to it, each
  // with a label, an SF Symbol and Material Symbol name, `destructive`
  // for delete, and `onSelect`.
  return <MyMenu items={actions}>{children}</MyMenu>;
}

<PlatformControlsProvider value={{ RowActions: MyRowMenu }}>
  <TableView … />
</PlatformControlsProvider>
```

The value is partial: what's given replaces the default, and every
other control stays the platform's. The slots' props are types in
`@workspace.sh/table-ui/shared` (`controlSlots.ts`), free of any
renderer, so another view library (table-gtk) offers the same actions
in its own controls. A component's static `gesture` ("Right-click a
row", "Touch and hold a row") words the views' hints.

`@expo/ui` is an optional peer dependency: only the iOS and Android
defaults load it, and they need a development build (not Expo Go).
