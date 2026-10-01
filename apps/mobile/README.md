# `@workspace.sh/table-mobile`

The `.table` demo for iOS and Android: Expo SDK 55 (React Native 0.83,
React 19.2, react-strict-dom 0.0.55), drawing the same views as the web,
macOS and Linux apps from `@workspace.sh/table-ui`.

Its state is table-app's reducer, as in the other apps
(`docs/APP-STATE.md`): `useTableApp` from `@workspace.sh/table-app/react`,
`derive` for what's drawn, and `viewCallbacks` for the views' edits, held
once for every screen in `TableAppContext.tsx`.

It targets **iOS 26 and later** (deployment target 26.0) and Android, in
development builds only (never Expo Go). It shows how a host frames the
views the platform's way; table-ui itself owns no navigation:
- **Navigation:** expo-router's native stack (`app/`). The table screen
  (`app/index.tsx`) has its view's name as the large title, the views in
  a menu (top right), the tables list button (top left), and a bottom
  toolbar with View settings, search and a ⋯ menu (New Table, New .table
  File, Open .table.zip, Export .table.zip). On iOS 26+ the bars, buttons
  and search are Liquid Glass, from the system. The tables list
  (`app/tables.tsx`) is a native form sheet with detents.
- **Storage:** edits and the viewer's settings are kept on the phone in
  AsyncStorage (`store.ts`), under the keys the web uses in localStorage.
- **Questions:** native alerts. On iOS a name (new table, new `.table`
  file) is asked in the system's alert with a text field; Android uses
  the app's `NameSheet.tsx` until it gets a Material dialog.
- **Files:** `files.ts` opens a `.table.zip` from the system's document
  picker and hands the file on screen to the share sheet
  (expo-document-picker, expo-file-system, expo-sharing). Reading and
  writing archives is table-app's.
- **Leaving:** going to the background writes what's left at once.

## Running it

- **iOS Simulator:** `npm run mobile:ios` from the repo root. It generates
  `ios/` (never edited by hand), builds, installs and starts Metro on 8082.
  After a change to `app.json` or a new native module, regenerate with
  `npx expo prebuild --clean --platform ios` first.
- **Physical devices:** Leslie runs the device builds. They pass
  `-allowProvisioningUpdates`, which agents must not use.
- **Android:** `npm run mobile:android` (a development build).
- If Expo's CLI fails with "Unexpected server error: No returned query
  result", run it offline: `EXPO_OFFLINE=1`, or `--offline` on
  `expo start`.
- Install a new native dependency with `npx expo install`, so its version
  matches SDK 55, then rebuild.
- The `mobile:*` scripts set `NODE_PATH` to this package's
  `node_modules`. npm hoists expo-router, expo-constants and the other
  expo modules to the repo root, but keeps `expo` itself here, and their
  config plugins and build scripts (run under plain Node) need it.

Checks: `npm run mobile:typecheck`, and
`npx expo export --platform ios|android` in this folder to bundle each
platform without a device.

## Xcode 27

- `patches/@expo+cli+…patch` backports Expo CLI's DeviceHub handling
  (Xcode 27 has no Simulator.app), applied by `postinstall`.
- `plugins/with-pods-deployment-floor.js` lifts every pod to the app's
  16.0 target, since Xcode 27 rejects anything under 15.0.

## Metro monorepo notes

Two non-default bits in `metro.config.js`:

1. **`watchFolders`** includes the monorepo root, so changes in
   `packages/*` live-reload.
2. **A custom `resolveRequest`** (the repo root's `metro-resolver.js`,
   shared with macOS) maps `.js` imports to their `.ts`/`.tsx` sources.
   `packages/core` uses `.js` extensions (the NodeNext convention for
   `tsc` and Node ESM), and Metro doesn't try `.ts` for an explicit `.js`
   request.
