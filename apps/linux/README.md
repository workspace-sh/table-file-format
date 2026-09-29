# `.table` on Linux

The harness for `@workspace.sh/table-gtk`, as `apps/web` is for
`table-ui`: GTK4 and libadwaita through [GTKX](https://gtkx.dev), reading
`.table` folders from disk with `table-app`'s loader.

It shows the repo's fixtures, or the `.table` folders named on the command
line, with the open table's views listed under it in the sidebar. Every
layout draws (table with sheets, groups and totals; board; gallery; list;
calendar), read-only so far. Editing and saving are next.

## Run it

Needs Node 24, GTK 4 and libadwaita (Fedora: `sudo dnf install gtk4 libadwaita`).

```sh
cd apps/linux
npm install        # not a root workspace member: a Mac never fetches GTK bindings
npm run codegen    # bindings for this machine's GTK and libadwaita
npm run dev        # the demo, with fast refresh
npm start -- ~/Documents/crm.table   # a build, on your own tables
```

`--open=crm/deals#all` starts on a table, and optionally a view.

## Check it

```sh
npm run check      # typecheck, lint, tests, build (covers packages/gtk too)
SCHEME=dark npm run shot -- out.png --open=household-budget/budget#sheet
```

`shot` runs the build on a headless sway and saves a screenshot (needs
`sway` and `grim`). A visual change isn't done until it's been looked at.

## How it's put together

- `packages/gtk` is linked in as a `file:` dependency, and Vite keeps the
  link's path (`preserveSymlinks`), so its `@gtkx/*` imports resolve from
  this app's `node_modules`. GTKX's build refuses bindings it can't reach
  from the importing file's own path.
- The other packages are read from their TypeScript source by alias
  (`vite.config.ts`), as the web demo reads them through the `source`
  condition. `tsconfig.json` maps the same paths.
- Nothing here may import `react-native`, `react-strict-dom`, `react-dom`
  or the `table-ui` views: the lint rules say so. Logic both renderers
  need goes in `table-ui/shared` or `table-app`.
