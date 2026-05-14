# `@workspace/table-mobile`

Expo 55 example consumer of `@workspace/table-core` for iOS and Android.

## Status

JS-side scaffolding only. The native `ios/` and `android/` directories
are generated locally and gitignored — run `npm run prebuild` to create
them.

The current `App.tsx` is a minimal list viewer that imports
`@workspace/table-core` and renders rows from an inline fixture. It does
**not yet** use `@workspace/table-ui` because that package currently uses
web-only APIs (`react-dom/createPortal`, web-only StyleX shadow syntax,
`document` event listeners). Lifting those components to be truly
cross-platform is the next iteration — see issue tracker.

## Bootstrap

From the monorepo root:

```sh
npm install
npm run prebuild -w @workspace/table-mobile      # generates ios/ and android/
npm run ios -w @workspace/table-mobile           # or `android` / `start`
```

`expo prebuild` materialises the native projects from `app.json`. Re-run
with `--clean` to wipe and regenerate.

## Reference

Structure mirrors `react-strict-dom-markdown`'s `example/ios-app` — the
canonical Expo 55 + RSD 0.0.55 setup the user pointed at.
