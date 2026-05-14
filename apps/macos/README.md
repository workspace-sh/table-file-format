# `@workspace/table-macos`

Bare RN + `react-native-macos` example consumer of `@workspace/table-core`
for macOS. **Not Expo** — Expo doesn't ship a macOS target.

## Status

JS-side scaffolding only. The native `macos/` directory (Xcode project,
Podfile, etc.) is not committed and must be generated locally. Same
shape as `react-strict-dom-markdown`'s `example/macos-app`.

The current `App.tsx` is a minimal table viewer that imports
`@workspace/table-core` and renders rows from an inline fixture. Like
the mobile app, it does not yet use `@workspace/table-ui` (web-only
APIs). Cross-platform UI lifting is a follow-up.

## Bootstrap

Initial setup (one time, from the monorepo root):

```sh
npm install --legacy-peer-deps
# Generate the macos/ directory with the RN-macos template. The
# react-strict-dom-markdown repo's example/macos-app is a good
# reference for the exact Xcode config.
cd apps/macos
npx react-native init MacosApp --template react-native@0.81 --skip-install
# (Move the generated macos/ subdirectory in; replace AppDelegate to
# register "TableMacos" as the root component.)
cd macos && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install && cd ..
```

Run:

```sh
npm run macos -w @workspace/table-macos
```

## Reference

`/Users/leslieoa/Code/Projects/workspace/Research/react-strict-dom-markdown`
— `example/macos-app` directory contains a working RN-macOS + RSD 0.0.55
+ react-native-macos 0.81.7 setup. Mirror its `macos/` Xcode project
layout when bootstrapping.
