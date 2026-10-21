# @workspace.sh/table-mac-controls

The Mac's own controls for the .table library's views (table-ui's slots), for any react-native-macos app that draws them:

- **A choice** (a choice cell, a select): the system's pop-up menu, the chosen one ticked.
- **A date, a time, or both:** the system's date picker in a popover pointing at the cell, as Reminders and Calendar show one.
- **A row's actions:** the system's context menu, on a right-click or Control-click.
- **Several choices** (a multi-select's tags, a link to several rows): a popover of the system's pointing at the cell, each choice with its tick and its tag, toggled as it's clicked, staying open until a click outside, Escape or Return.

## Using it

```tsx
import { macControls, watchRowMenus } from "@workspace.sh/table-mac-controls";

// Once, at the app's root:
useEffect(() => watchRowMenus(), []);

<PlatformControlsProvider value={macControls}>…</PlatformControlsProvider>
```

and link the pod in the app's `Podfile`:

```ruby
pod 'TableMacControls', :path => '<path to this package>/macos'
```

Menus and pickers open in the React surface under the click that opened them (else the one holding the keyboard), so an app can have several (a window, an inspector, a sheet). The development helpers (`popUpChoose`, `popUpTitles`, `datePickerShown`, `datePickerSet`, `datePickerClose`) drive them from a debugger, since nothing reaches an app while one of its menus is open.
