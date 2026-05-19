# `@workspace/table-desktop`

Bare RN + `react-native-macos` example consumer of `@workspace/table-core`.
Currently macOS-only; folder named `desktop` so future Windows/Linux
targets can sit alongside `macos/` inside.

**Not Expo** — Expo doesn't ship a macOS target. Mirrors the layout used
by the parent `workspace` product (`apps/desktop/macos/` for the Xcode
project) and `react-native-source-editor`'s `example/macos-app`.

## Status

`App.tsx` imports `@workspace/table-core` and renders a minimal table
viewer over an inline fixture. The Xcode project under `macos/` is
committed (bare RN — not CNG). It does not yet use
`@workspace/table-ui` (web-only APIs). Cross-platform UI lifting is a
follow-up.

## Standalone install, not a workspace member

Unlike `apps/web` and `apps/mobile`, this app is **NOT** in the root
`workspaces` array — it has its own `node_modules` and
`package-lock.json`. That's deliberate: RN-macOS's generated Xcode
build phases hardcode `${PODS_ROOT}/../../node_modules/X` paths
(notably the hermes-engine "Replace Hermes" script). In an npm
workspaces monorepo those packages hoist to the repo root and the
hardcoded paths break.

`@workspace/table-core` is linked locally via `file:../../packages/core`
— npm 9+ symlinks `file:` deps by default, so live edits in
`packages/core/src/` propagate to desktop without a rebuild step.

This mirrors what `workspace-sh/workspace`'s `apps/desktop` and
`workspace.sh/markdown`'s `example/macos-app` do: bare RN apps stay
standalone; only library packages and lighter-weight apps (Expo,
Vite/web) live as workspace members.

## Bootstrap (one-time)

```sh
# From the monorepo root:
npm install --legacy-peer-deps    # installs root + packages/* + apps/web + apps/mobile
npm run desktop:install           # installs apps/desktop standalone
npm run desktop:pods              # CocoaPods inside apps/desktop/macos
```

That's it. Run with the commands below.

## Run

```sh
npm run desktop:macos               # build + launch
# or
npm run desktop:dev                 # start (clean) + macos in parallel
```

## Layout

```
apps/desktop/
├── App.tsx
├── index.js                      AppRegistry.registerComponent("TableDesktop", ...)
├── package.json                  start / macos / typecheck
├── metro.config.js
└── macos/
    ├── Podfile                   monorepo-aware walk-up to root node_modules
    ├── TableDesktop.xcodeproj/
    ├── TableDesktop.xcworkspace/
    └── TableDesktop-macOS/
        ├── AppDelegate.h / .mm   moduleName = "TableDesktop"; bundleRoot = "index"
        ├── Info.plist
        ├── main.m
        ├── TableDesktop.entitlements
        ├── Assets.xcassets/
        └── Base.lproj/Main.storyboard
```

Bundle id: `sh.workspace.table.desktop` (mirrors `sh.workspace.table.mobile`).
Deployment target: macOS 14.0. New Architecture (Fabric) enabled.

## Reference

[`workspace-sh/react-native-source-editor`](https://github.com/workspace-sh/react-native-source-editor)'s
`example/macos-app/` — working RN-macOS + RSD 0.0.55 + react-native-macos
0.81.7 setup; the canonical source for the macos/ Xcode project structure.

Workspace product's `apps/desktop/` is the other in-org reference for
this exact folder shape.

## Xcode 26 / fmt consteval workaround

The `Podfile`'s `post_install` hook patches `Pods/fmt/include/fmt/base.h`
to disable `FMT_USE_CONSTEVAL` on Apple Clang 17+ (Xcode 26+), where
consteval is broken. Removable once fmt or Apple ships a fix. Lifted
verbatim from `react-native-source-editor`'s Podfile.
