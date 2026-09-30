# `@workspace.sh/table-mobile`

The `.table` demo for iOS and Android: Expo SDK 55 (React Native 0.83,
React 19.2, react-strict-dom 0.0.55), drawing the same views as the web,
macOS and Linux apps from `@workspace.sh/table-ui`.

Its state is table-app's reducer, as in the other apps
(`docs/APP-STATE.md`): `useTableApp` from `@workspace.sh/table-app/react`,
`derive` for what's drawn, and `viewCallbacks` for the views' edits.
What's its own:
- **Storage:** edits and the viewer's settings are kept on the phone in
  AsyncStorage (`store.ts`), under the keys the web uses in localStorage.
  It works in Expo Go as well as in a development build.
- **Questions:** native alerts. A name (new table, new `.table` file) is
  asked for in the app's own small sheet (`NameSheet.tsx`), the same on
  iOS and Android, which has no system text prompt.
- **Files:** the tables sheet (`TablesSheet.tsx`) makes tables and
  `.table` files, opens a `.table.zip` from the system's document picker,
  and hands the file on screen to the share sheet as a `.table.zip`
  (`files.ts`: expo-document-picker, expo-file-system and expo-sharing,
  all in Expo Go). Reading and writing archives is table-app's.
- **Leaving:** going to the background writes what's left at once.

## Running it

- **iOS Simulator:** `npm run mobile:ios` from the repo root. It generates
  `ios/` (never edited by hand), builds, installs and starts Metro on 8082.
- **Physical devices:** Leslie runs the device builds. They pass
  `-allowProvisioningUpdates`, which agents must not use.
- **Android:** `npm run mobile:android`, or Expo Go against
  `npm run mobile:start`.
- If Expo's CLI fails with "Unexpected server error: No returned query
  result", run it offline: `EXPO_OFFLINE=1`, or `--offline` on
  `expo start`.
- A new native dependency (one Expo Go doesn't include) needs a rebuild,
  not just a reload. Install it with `npx expo install` so its version
  matches SDK 55.

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
