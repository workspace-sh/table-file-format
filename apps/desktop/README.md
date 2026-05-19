# `@workspace/table-desktop`

Bare RN + `react-native-macos` example consumer of `@workspace/table-core`.
Currently macOS-only; folder named `desktop` so future Windows/Linux
targets can sit alongside `macos/` inside.

**Not Expo** — Expo doesn't ship a macOS target. Mirrors the layout used
by the parent `workspace` product (`apps/desktop/macos/` for the Xcode
project) and `react-native-source-editor`'s `example/macos-app`.

## Status

JS-side scaffolding only. The native `macos/` directory (Xcode project,
Podfile, etc.) is not committed and must be generated locally.

`App.tsx` imports `@workspace/table-core` and renders a minimal table
viewer over an inline fixture. It does not yet use `@workspace/table-ui`
(web-only APIs). Cross-platform UI lifting is a follow-up.

## Bootstrap (one-time)

```sh
# From the monorepo root:
npm install --legacy-peer-deps

# Mirror the macos/ Xcode project structure from
# /Users/leslieoa/Code/Projects/workspace/Research/react-native-source-editor/example/macos-app/macos/
# Key things to set in AppDelegate: register "TableDesktop" as the root
# component (matches apps/desktop/index.js).

# Then:
npm run desktop:pods                # cd apps/desktop/macos && pod install
```

## Run

```sh
npm run desktop:macos               # build + launch
# or
npm run desktop:dev                 # start (clean) + macos in parallel
```

## Reference

`/Users/leslieoa/Code/Projects/workspace/Research/react-native-source-editor/example/macos-app/`
— working RN-macOS + RSD 0.0.55 + react-native-macos 0.81.7 setup.
Mirror its `macos/` Xcode project layout when bootstrapping.

The parent `workspace` product's `apps/desktop/` is the canonical
in-org reference for this exact folder shape.
