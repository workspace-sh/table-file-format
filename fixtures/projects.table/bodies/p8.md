# Plugin SDK

A third-party extension surface for the Workspace runtime. Goal: let
the community ship new view layouts, field types, and integrations
without forking.

## Surfaces

- **View plugins** — register a new `view.layout` value and a renderer
  component. Receives the same `ViewProps` core ships internally.
- **Field-type plugins** — register a `schema.fields[].type` value, a
  validator, an editor component, and a display component.
- **Sync providers** — pluggable backends behind the local-first sync
  protocol.

## Open questions

- Sandboxing model. JS sandbox vs. WASM vs. trust-the-author.
- Distribution. NPM? Workspace marketplace? Both?
- Versioning of the host API. SemVer per surface or single host version.
