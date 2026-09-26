// Generated from fixtures/projects.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedTable } from "@workspace.sh/table-core";

export const projectsTable: ParsedTable = {
  "schema": {
    "fields": [
      {
        "name": "title",
        "type": "string",
        "constraints": {
          "required": true
        }
      },
      {
        "name": "status",
        "type": "string",
        "constraints": {
          "enum": [
            "planning",
            "active",
            "on-hold",
            "done"
          ]
        }
      },
      {
        "name": "owner",
        "type": "string"
      },
      {
        "name": "budget",
        "type": "number",
        "format": "currency:USD"
      },
      {
        "name": "launched",
        "type": "date"
      },
      {
        "name": "summary",
        "type": "string",
        "format": "markdown"
      },
      {
        "name": "per_month",
        "title": "Budget / month",
        "type": "number",
        "computed": {
          "expr": "(round (/ budget 12) 0)",
          "dialect": "table-expr-v1"
        }
      }
    ],
    "primaryKey": [
      "title"
    ],
    "schema-version": 1
  },
  "rows": [
    {
      "id": "p1",
      "title": "Workspace v1",
      "status": "active",
      "owner": "leslie",
      "budget": 80000,
      "launched": "2026-01-15",
      "summary": "Local-first markdown app for information workers"
    },
    {
      "id": "p2",
      "title": "Table file format spike",
      "status": "done",
      "owner": "leslie",
      "budget": 0,
      "launched": "2026-04-20",
      "summary": "Open .table format research"
    },
    {
      "id": "p3",
      "title": "iOS Pro launch",
      "status": "planning",
      "owner": "leslie",
      "budget": 25000,
      "summary": "Premium tier on the App Store"
    },
    {
      "id": "p4",
      "title": "Web companion app",
      "status": "planning",
      "owner": "claude",
      "budget": 15000,
      "summary": "Web read-only viewer"
    },
    {
      "id": "p5",
      "title": "Sync engine",
      "status": "on-hold",
      "owner": "claude",
      "budget": 40000,
      "summary": "P2P sync between devices"
    },
    {
      "id": "p6",
      "title": "Brand redesign",
      "status": "done",
      "owner": "sam",
      "budget": 12000,
      "launched": "2026-03-01",
      "summary": "Visual identity refresh"
    },
    {
      "id": "p7",
      "title": "Docs site",
      "status": "active",
      "owner": "sam",
      "budget": 5000,
      "launched": "2026-04-01",
      "summary": "Public-facing documentation"
    },
    {
      "id": "p8",
      "title": "Plugin SDK",
      "status": "planning",
      "owner": "claude",
      "budget": 35000,
      "summary": "Third-party extension API"
    },
    {
      "id": "p9",
      "title": "Onboarding flow",
      "status": "active",
      "owner": "sam",
      "budget": 8000,
      "launched": "2026-02-10",
      "summary": "First-run experience and templates"
    },
    {
      "id": "p10",
      "title": "Encrypted vaults",
      "status": "on-hold",
      "owner": "leslie",
      "budget": 50000,
      "summary": "Per-workspace E2EE — blocked on KMS decision"
    },
    {
      "id": "p11",
      "title": "Search v2",
      "status": "active",
      "owner": "claude",
      "budget": 18000,
      "launched": "2026-03-22",
      "summary": "Full-text + structured query across the workspace"
    },
    {
      "id": "p12",
      "title": "Q2 marketing site",
      "status": "done",
      "owner": "sam",
      "budget": 7000,
      "launched": "2026-04-05",
      "summary": "Landing page refresh and pricing"
    },
    {
      "id": "p13",
      "title": "AI assist",
      "status": "planning",
      "owner": "leslie",
      "budget": 22000,
      "summary": "Inline LLM helpers for writing and table editing"
    },
    {
      "id": "p14",
      "title": "Mobile beta",
      "status": "active",
      "owner": "leslie",
      "budget": 11000,
      "launched": "2026-04-12",
      "summary": "TestFlight + Play Console internal track"
    },
    {
      "id": "p15",
      "title": "Templates gallery",
      "status": "done",
      "owner": "sam",
      "budget": 3500,
      "launched": "2026-03-15",
      "summary": "Curated starting points — projects, OKRs, CRMs"
    },
    {
      "id": "p16",
      "title": "API stability v1",
      "status": "planning",
      "owner": "claude",
      "budget": 9000,
      "summary": "Lock public types, write the migration guide"
    },
    {
      "id": "p17",
      "title": "Performance pass",
      "status": "on-hold",
      "owner": "claude",
      "budget": 6000,
      "summary": "Large-vault rendering — needs profiling tooling first"
    }
  ],
  "views": [
    {
      "id": "v1",
      "name": "All projects",
      "layout": "table",
      "fields": [
        "title",
        "status",
        "owner",
        "launched"
      ]
    },
    {
      "id": "v2",
      "name": "Active by owner",
      "layout": "table",
      "filter": [
        {
          "field": "status",
          "operator": "eq",
          "value": "active"
        }
      ],
      "sort": [
        {
          "field": "owner",
          "direction": "asc"
        }
      ]
    },
    {
      "id": "v3",
      "name": "Roadmap",
      "layout": "table",
      "fields": [
        "title",
        "status",
        "launched"
      ],
      "sort": [
        {
          "field": "launched",
          "direction": "asc"
        }
      ]
    },
    {
      "id": "v4",
      "name": "By owner",
      "layout": "table",
      "group": {
        "field": "owner"
      }
    },
    {
      "id": "v5",
      "name": "Board by status",
      "layout": "board",
      "board_field": "status",
      "fields": [
        "title",
        "owner",
        "budget"
      ]
    },
    {
      "id": "v6",
      "name": "Gallery",
      "layout": "gallery",
      "gallery_field": "summary",
      "fields": [
        "title",
        "owner",
        "status"
      ]
    },
    {
      "id": "v7",
      "name": "Quick list",
      "layout": "list",
      "fields": [
        "title",
        "owner"
      ]
    },
    {
      "id": "v8",
      "name": "Calendar",
      "layout": "calendar",
      "calendar_field": "launched"
    },
    {
      "id": "v9",
      "name": "Q1 2026",
      "layout": "calendar",
      "calendar_field": "launched",
      "calendar_range": {
        "start": "2026-01-01",
        "end": "2026-03-31"
      }
    },
    {
      "id": "v10",
      "name": "Budgets",
      "layout": "table",
      "fields": [
        "title",
        "owner",
        "budget",
        "per_month"
      ],
      "sort": [
        {
          "field": "per_month",
          "direction": "desc"
        }
      ]
    }
  ],
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Projects",
    "description": "Workspace product roadmap",
    "created_at": "2026-04-01T00:00:00Z",
    "modified_at": "2026-04-27T00:00:00Z",
    "generator": "table-file-format spike fixture"
  },
  "path": "fixtures/projects.table",
  "bodies": {
    "p10": "# Encrypted vaults\n\nPer-workspace end-to-end encryption. Each workspace gets its own\nkeypair; the user holds the private key, the cloud only sees\nciphertext.\n\n## Why on-hold\n\nThe KMS choice is blocking everything else. Three candidates:\n\n1. **Apple CloudKit + Keychain.** Free for Apple-platform users,\n   zero-config sync of the private key between the user's devices.\n   Useless for cross-platform users (web, Android).\n2. **Passkeys + WebAuthn.** Cross-platform, no password to forget,\n   but the threat model around device loss + recovery is fuzzy.\n3. **Roll our own.** Maximum control, minimum free time.\n\nDecision parked until Q3 — too many other things gate on the answer.\n",
    "p13": "# AI assist\n\nInline LLM helpers anchored at the cursor, not bolted onto a sidebar.\n\n## Targets\n\n- **Writing**: complete a paragraph, rewrite for tone, summarise a\n  long body.\n- **Tables**: \"add a status field with these enum values\", \"rewrite\n  this column as title-case\", \"what's the median budget across\n  active projects\".\n\n## Constraints\n\n- Local-first. The default backend is a local model; cloud is opt-in\n  per workspace.\n- No silent telemetry. Every request shows where it ran and what got\n  sent.\n- Works offline for local-model paths.\n",
    "p2": "# Table file format spike\n\nOpen, app-agnostic data-matrix file format. Sits in the same niche as\nAirtable, Google Tables, and Obsidian Bases — a portable database that\nalso reads as a spreadsheet for information workers.\n\n## Architecture\n\nA `.table/` is a directory:\n\n- `schema.json` — own schema vocabulary (not Frictionless-aligned)\n- `rows.ndjson` — one JSON record per line, every row carries a system `id`\n- `views.json` — saved views (table, board, gallery, list, calendar)\n- `meta.json` — manifest, generator, timestamps\n- `attachments/` — files referenced by row values\n- `bodies/{id}.md` — optional long-form markdown bodies, Notion-style\n- `index.sqlite` — optional rebuildable cache (gitignored)\n\n## Goals\n\n1. Information workers can move structured data between apps without\n   lock-in. Plain text, line-diffable, greppable.\n2. Workspace's wider thesis is local-first markdown plus structured\n   data; `.table/` is the structured-data half.\n3. Doubles as a `react-strict-dom` playground for the Workspace UI\n   layer ahead of the Expo migration.\n",
    "p8": "# Plugin SDK\n\nA third-party extension surface for the Workspace runtime. Goal: let\nthe community ship new view layouts, field types, and integrations\nwithout forking.\n\n## Surfaces\n\n- **View plugins** — register a new `view.layout` value and a renderer\n  component. Receives the same `ViewProps` core ships internally.\n- **Field-type plugins** — register a `schema.fields[].type` value, a\n  validator, an editor component, and a display component.\n- **Sync providers** — pluggable backends behind the local-first sync\n  protocol.\n\n## Open questions\n\n- Sandboxing model. JS sandbox vs. WASM vs. trust-the-author.\n- Distribution. NPM? Workspace marketplace? Both?\n- Versioning of the host API. SemVer per surface or single host version.\n"
  }
};
