# @workspace.sh/table-mac-controls

The Mac's own controls for the .table library's views (table-ui's slots), for any react-native-macos app that draws them:

- **A choice** (a choice cell, a select): the system's pop-up menu, the chosen one ticked.
- **A date, a time, or both:** the system's date picker in a popover pointing at the cell, as Reminders and Calendar show one.
- **A row's actions:** the system's context menu, on a right-click or Control-click.
- **Settings** (a field's, a new field's, a view's): the system's grouped form in the window's inspector, the trailing pane, as the Format sidebar is in Pages. It's deep work, so a quick choice stays a popover or a menu.
- **Several choices** (a multi-select's tags, a link to several rows): a popover of the system's pointing at the cell, each choice with its tick and its tag, toggled as it's clicked, staying open until a click outside, Escape or Return.

## Using it

```tsx
import { macControls, watchRowMenus } from "@workspace.sh/table-mac-controls";

// Once, at the app's root:
useEffect(() => watchRowMenus(), []);

<PlatformControlsProvider value={macControls}>…</PlatformControlsProvider>
```

For settings in the inspector, give the views the inspector's sheet and form as well (`Page` is however the app presents anything else, a row's page say):

```tsx
import { MacSettingsForm, macControls, macSheet } from "@workspace.sh/table-mac-controls";

const controls = { ...macControls, Sheet: macSheet(Page), SettingsForm: MacSettingsForm };
```

and add the pane to the window's split view, with a toolbar button that sends `toggleInspector:`:

```swift
splitViewController.addSplitViewItem(TableInspector.makeItem())
```

An app with an inspector of its own (the .table demo) draws `TableSettingsFormView` there and hands its way to it to `setSettingsTransport`.

and link the pod in the app's `Podfile`:

```ruby
pod 'TableMacControls', :path => '<path to this package>/macos'
```

Menus and pickers open in the React surface under the click that opened them (else the one holding the keyboard), so an app can have several (a window, an inspector, a sheet). The development helpers (`popUpChoose`, `popUpTitles`, `datePickerShown`, `datePickerSet`, `datePickerClose`) drive them from a debugger, since nothing reaches an app while one of its menus is open.
