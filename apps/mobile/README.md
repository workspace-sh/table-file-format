# `@workspace.sh/table-mobile`

Expo **56 preview** consumer of `@workspace.sh/table-core` for iOS and Android.

(Originally planned to target Expo 57 beta — that doesn't exist yet,
newest published is `expo@next` = `56.0.0-preview.11`. Falling back to
56 preview matches the user's "use the newest beta" intent and pairs
with RN 0.85.)

## Status

Verified clean as of restructure:
- `npm run typecheck` — passes
- `npx expo prebuild --clean --no-install` — generates `ios/` + `android/`
- `npx expo export --platform ios` — Metro bundles 584 modules
  (1.7MB Hermes bytecode) without errors

Not yet attempted on a real device or simulator. Once you have a
simulator handy:

```sh
npm run prebuild -w @workspace.sh/table-mobile      # generates ios/ and android/
npm run ios -w @workspace.sh/table-mobile           # or `android` / `start`
```

The current `App.tsx` is a minimal list viewer that imports
`@workspace.sh/table-core` and renders rows from an inline fixture. It does
not yet use `@workspace.sh/table-ui` because that package currently uses
web-only APIs (`react-dom/createPortal`, web-only `:focus-within`,
`document.pointermove`). Lifting those to be cross-platform is the next
iteration.

## Metro monorepo notes

Two non-default bits in `metro.config.js`:

1. **`watchFolders`** includes the monorepo root so changes in
   `packages/*` live-reload.
2. **Custom `resolveRequest`** maps `.js` extensions in relative imports
   to `.ts`/`.tsx` source files. `packages/core` is TypeScript using
   `.js` extensions (NodeNext convention required for `tsc` + Node ESM),
   but Metro doesn't try `.ts` when it sees an explicit `.js` request.
   Without the shim, every `import "./types.js"` inside the core package
   fails to resolve at bundle time.

## Reference

Structure mirrors `react-strict-dom-markdown`'s `example/ios-app`. Pinned
versions match the latest equivalent: Expo 56 preview, RN 0.85, React 19.2,
RSD 0.0.55, `react-native-safe-area-context` 5.6.x.
