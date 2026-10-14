# Developing

Every command the repository's root offers. The Linux app has its own,
in [apps/linux/README.md](../apps/linux/README.md).

Pinned to Node 22.20.0 via `.nvmrc` (matches the rest of the
workspace-sh org). If your nvm/fnm auto-switches on cd, you don't have
to think about it.

All commands run from the monorepo root. Namespaced consistently so the
syntax is the same across every surface.

```sh
npm install                       # installs everything; symlinks workspace packages

# Format library
npm run core:build                # tsc → packages/core/dist/
npm run core:test                 # node:test suite
npm run core:test:watch           # watch mode
npm run core:typecheck

# Web (full demo). Edits are kept in the browser that made them, never in
# the repo, until that browser's data is cleared or you press Reset demo
# data in the sidebar.
npm run web:dev                   # vite at http://localhost:5173
npm run web:build                 # production bundle (PAGES_BASE=/table-file-format/ for GitHub Pages)
npm run web:preview               # preview the built bundle
npm run web:typecheck
npm run test -w @workspace.sh/table-web   # the demo's own tests
npm run dev                       # alias for `web:dev`

# Mobile (Expo 55, iOS + Android — Metro on port 8082)
# Expo's `run:ios` / `run:android` start Metro themselves; no concurrency needed.
npm run mobile:prebuild           # generate ios/ + android/ via CNG
npm run mobile:start              # expo start --dev-client --port 8082
npm run mobile:clear              # watchman watch-del-all + expo start --clear
npm run mobile:ios                # expo run:ios on simulator (starts Metro)
npm run mobile:ios:device         # expo run:ios --device
npm run mobile:ios:device:release # expo run:ios --device --configuration Release
npm run mobile:android            # expo run:android on emulator (starts Metro)
npm run mobile:android:device     # expo run:android --device
npm run mobile:typecheck

# Desktop (bare RN + react-native-macos, Metro on port 8083)
# Bare RN needs Metro + run-macos as separate processes — :dev handles both.
# First time: bootstrap the native macos/ Xcode project — see
# apps/desktop/README.md (mirror react-native-source-editor's setup).
npm run desktop:pods              # cd macos && pod install
npm run desktop:start             # start --reset-cache (port 8083)
npm run desktop:start:clean       # watchman clear + start --reset-cache
npm run desktop:macos             # react-native run-macos --port 8083
npm run desktop:dev               # concurrently: start:clean + macos
npm run desktop:typecheck

# UI and app packages
npm run ui:typecheck
npm run ui:test
npm run app:typecheck
npm run app:test

# Fixtures and formula conformance
npm run fixtures:test
npm run conformance:run           # measures formula engines against the OpenFormula cases
npm run conformance:test
```

> **Heads-up on npm 11 + workspaces:** lifecycle script names (`test`,
> `build`, `start`) propagate to every workspace by default, which fails
> on workspaces that don't define them. That's why root scripts are
> namespaced (`core:test`, not `test`). Avoid running bare `npm test` /
> `npm build` / `npm start` at the root — use the namespaced commands.
