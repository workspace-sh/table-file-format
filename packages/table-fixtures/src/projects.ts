// Generated from fixtures/projects.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const projectsBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
    "title": "Projects",
    "description": "Workspace product roadmap, and the tasks in each project.",
    "tables": [
      "projects",
      "tasks"
    ],
    "created_at": "2026-04-01T00:00:00Z",
    "modified_at": "2026-04-27T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "tables": {
    "projects": {
      "schema": {
        "fields": [
          {
            "id": "j49tkemwbf17r",
            "name": "title",
            "type": "string",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "ct5d6ndk38c8d",
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
            "id": "yr8ozrtbxgqew",
            "name": "owner",
            "type": "string"
          },
          {
            "id": "pio7bjir814ui",
            "name": "budget",
            "type": "number",
            "format": "currency:USD"
          },
          {
            "id": "eh7e4khtyxy3q",
            "name": "launched",
            "type": "date"
          },
          {
            "id": "ej3mhf9y1u1bq",
            "name": "summary",
            "type": "string",
            "format": "markdown"
          },
          {
            "id": "q7pgmobychcd7",
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
          "id": "xsdxifzn73ohismzm8q5uri8fe",
          "title": "Workspace v1",
          "status": "active",
          "owner": "leslie",
          "budget": 80000,
          "launched": "2026-01-15",
          "summary": "Local-first markdown app for information workers"
        },
        {
          "id": "1h38m5st7rwanz3hyjb6dy8igr",
          "title": "Table file format spike",
          "status": "done",
          "owner": "leslie",
          "budget": 0,
          "launched": "2026-04-20",
          "summary": "Open .table format research"
        },
        {
          "id": "4csppbyqkcmq3kf4y7zbxeeumg",
          "title": "iOS Pro launch",
          "status": "planning",
          "owner": "leslie",
          "budget": 25000,
          "summary": "Premium tier on the App Store"
        },
        {
          "id": "hd7ttdzeb5z53faz9agiearrek",
          "title": "Web companion app",
          "status": "planning",
          "owner": "claude",
          "budget": 15000,
          "summary": "Web read-only viewer"
        },
        {
          "id": "o65fjfegds8n54xqbkg9hkf5cq",
          "title": "Sync engine",
          "status": "on-hold",
          "owner": "claude",
          "budget": 40000,
          "summary": "P2P sync between devices"
        },
        {
          "id": "f9mb4njiyywtmjt8gr9i138x8t",
          "title": "Brand redesign",
          "status": "done",
          "owner": "sam",
          "budget": 12000,
          "launched": "2026-03-01",
          "summary": "Visual identity refresh"
        },
        {
          "id": "knapbng9n8qtguzrxfj7n6uudd",
          "title": "Docs site",
          "status": "active",
          "owner": "sam",
          "budget": 5000,
          "launched": "2026-04-01",
          "summary": "Public-facing documentation"
        },
        {
          "id": "btwsx6crxzmgjrztuu8f3yq3pi",
          "title": "Plugin SDK",
          "status": "planning",
          "owner": "claude",
          "budget": 35000,
          "summary": "Third-party extension API"
        },
        {
          "id": "ztnp9tt6sgx7g9zdfr4pmtzem8",
          "title": "Onboarding flow",
          "status": "active",
          "owner": "sam",
          "budget": 8000,
          "launched": "2026-02-10",
          "summary": "First-run experience and templates"
        },
        {
          "id": "ryumw55g4nqi7ytmzrudb7fyru",
          "title": "Encrypted vaults",
          "status": "on-hold",
          "owner": "leslie",
          "budget": 50000,
          "summary": "Per-workspace E2EE — blocked on KMS decision"
        },
        {
          "id": "pouuicupd6beu935kg6yrruyi1",
          "title": "Search v2",
          "status": "active",
          "owner": "claude",
          "budget": 18000,
          "launched": "2026-03-22",
          "summary": "Full-text + structured query across the workspace"
        },
        {
          "id": "t3cw5afjbx8kkg89d36ccjhk5j",
          "title": "Q2 marketing site",
          "status": "done",
          "owner": "sam",
          "budget": 7000,
          "launched": "2026-04-05",
          "summary": "Landing page refresh and pricing"
        },
        {
          "id": "jqujockyrs4yw6k6uue9h97tp1",
          "title": "AI assist",
          "status": "planning",
          "owner": "leslie",
          "budget": 22000,
          "summary": "Inline LLM helpers for writing and table editing"
        },
        {
          "id": "8krw3ahry4oh7r8x5mmcm8fwsq",
          "title": "Mobile beta",
          "status": "active",
          "owner": "leslie",
          "budget": 11000,
          "launched": "2026-04-12",
          "summary": "TestFlight + Play Console internal track"
        },
        {
          "id": "scfnxcnt9pkzg64ts51thyrzep",
          "title": "Templates gallery",
          "status": "done",
          "owner": "sam",
          "budget": 3500,
          "launched": "2026-03-15",
          "summary": "Curated starting points — projects, OKRs, CRMs"
        },
        {
          "id": "xghdfnu8qz63g44cf9t1kua5do",
          "title": "API stability v1",
          "status": "planning",
          "owner": "claude",
          "budget": 9000,
          "summary": "Lock public types, write the migration guide"
        },
        {
          "id": "dqtmojc9dbn8ks5seoq5sno48a",
          "title": "Performance pass",
          "status": "on-hold",
          "owner": "claude",
          "budget": 6000,
          "summary": "Large-vault rendering — needs profiling tooling first"
        }
      ],
      "views": [
        {
          "id": "ffaisc1zows4dzhy7aq5jrebkx",
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
          "id": "gzrqtgo1p3gfehto7tani3jzz4",
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
          "id": "tsaw1n3171mm9pu8zugkzm9pog",
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
          "id": "r1mmz6bdngh1qjdyc7a3u3n58c",
          "name": "By owner",
          "layout": "table",
          "group": {
            "field": "owner"
          }
        },
        {
          "id": "f185otbhy1gqy4e6e8fk9ehbz9",
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
          "id": "yxqsjf1fmbakwepxpx4ta44xks",
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
          "id": "u5fpdkwh5w9thdq8o368a9t4nw",
          "name": "Quick list",
          "layout": "list",
          "fields": [
            "title",
            "owner"
          ]
        },
        {
          "id": "m9ha81uuwcoba6qb1y36jexyy4",
          "name": "Calendar",
          "layout": "calendar",
          "calendar_field": "launched"
        },
        {
          "id": "mjgwimtp1b49fgtgp5zdr5pzq9",
          "name": "Q1 2026",
          "layout": "calendar",
          "calendar_field": "launched",
          "calendar_range": {
            "start": "2026-01-01",
            "end": "2026-03-31"
          }
        },
        {
          "id": "9o3aahftejwwkwbs4si48zmqwo",
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
        "title": "Projects",
        "description": "Workspace product roadmap",
        "created_at": "2026-04-01T00:00:00Z",
        "modified_at": "2026-04-27T00:00:00Z"
      },
      "path": "fixtures/projects.table/tables/projects",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "xsdxifzn73ohismzm8q5uri8fe",
            "1h38m5st7rwanz3hyjb6dy8igr",
            "4csppbyqkcmq3kf4y7zbxeeumg",
            "hd7ttdzeb5z53faz9agiearrek",
            "o65fjfegds8n54xqbkg9hkf5cq",
            "f9mb4njiyywtmjt8gr9i138x8t",
            "knapbng9n8qtguzrxfj7n6uudd",
            "btwsx6crxzmgjrztuu8f3yq3pi",
            "ztnp9tt6sgx7g9zdfr4pmtzem8",
            "ryumw55g4nqi7ytmzrudb7fyru",
            "pouuicupd6beu935kg6yrruyi1",
            "t3cw5afjbx8kkg89d36ccjhk5j",
            "jqujockyrs4yw6k6uue9h97tp1",
            "8krw3ahry4oh7r8x5mmcm8fwsq",
            "scfnxcnt9pkzg64ts51thyrzep",
            "xghdfnu8qz63g44cf9t1kua5do",
            "dqtmojc9dbn8ks5seoq5sno48a"
          ]
        }
      ],
      "bodies": {
        "1h38m5st7rwanz3hyjb6dy8igr": "# Table file format spike\n\nOpen, app-agnostic data-matrix file format. Sits in the same niche as\nAirtable, Google Tables, and Obsidian Bases — a portable database that\nalso reads as a spreadsheet for information workers.\n\n## Architecture\n\nA `.table/` is a directory:\n\n- `schema.json` — own schema vocabulary (not Frictionless-aligned)\n- `rows.ndjson` — one JSON record per line, every row carries a system `id`\n- `views.json` — saved views (table, board, gallery, list, calendar)\n- `meta.json` — manifest, generator, timestamps\n- `attachments/` — files referenced by row values\n- `bodies/{id}.md` — optional long-form markdown bodies, Notion-style\n- `index.sqlite` — optional rebuildable cache (gitignored)\n\n## Goals\n\n1. Information workers can move structured data between apps without\n   lock-in. Plain text, line-diffable, greppable.\n2. Workspace's wider thesis is local-first markdown plus structured\n   data; `.table/` is the structured-data half.\n3. Doubles as a `react-strict-dom` playground for the Workspace UI\n   layer ahead of the Expo migration.\n",
        "btwsx6crxzmgjrztuu8f3yq3pi": "# Plugin SDK\n\nA third-party extension surface for the Workspace runtime. Goal: let\nthe community ship new view layouts, field types, and integrations\nwithout forking.\n\n## Surfaces\n\n- **View plugins** — register a new `view.layout` value and a renderer\n  component. Receives the same `ViewProps` core ships internally.\n- **Field-type plugins** — register a `schema.fields[].type` value, a\n  validator, an editor component, and a display component.\n- **Sync providers** — pluggable backends behind the local-first sync\n  protocol.\n\n## Open questions\n\n- Sandboxing model. JS sandbox vs. WASM vs. trust-the-author.\n- Distribution. NPM? Workspace marketplace? Both?\n- Versioning of the host API. SemVer per surface or single host version.\n",
        "jqujockyrs4yw6k6uue9h97tp1": "# AI assist\n\nInline LLM helpers anchored at the cursor, not bolted onto a sidebar.\n\n## Targets\n\n- **Writing**: complete a paragraph, rewrite for tone, summarise a\n  long body.\n- **Tables**: \"add a status field with these enum values\", \"rewrite\n  this column as title-case\", \"what's the median budget across\n  active projects\".\n\n## Constraints\n\n- Local-first. The default backend is a local model; cloud is opt-in\n  per workspace.\n- No silent telemetry. Every request shows where it ran and what got\n  sent.\n- Works offline for local-model paths.\n",
        "ryumw55g4nqi7ytmzrudb7fyru": "# Encrypted vaults\n\nPer-workspace end-to-end encryption. Each workspace gets its own\nkeypair; the user holds the private key, the cloud only sees\nciphertext.\n\n## Why on-hold\n\nThe KMS choice is blocking everything else. Three candidates:\n\n1. **Apple CloudKit + Keychain.** Free for Apple-platform users,\n   zero-config sync of the private key between the user's devices.\n   Useless for cross-platform users (web, Android).\n2. **Passkeys + WebAuthn.** Cross-platform, no password to forget,\n   but the threat model around device loss + recovery is fuzzy.\n3. **Roll our own.** Maximum control, minimum free time.\n\nDecision parked until Q3 — too many other things gate on the answer.\n"
      }
    },
    "tasks": {
      "schema": {
        "fields": [
          {
            "id": "j49tkemwbf17r",
            "name": "title",
            "type": "string",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "knaba835qfmuj",
            "name": "project",
            "type": "string",
            "relation": {
              "table": "projects",
              "field": "id"
            }
          },
          {
            "id": "ct5d6ndk38c8d",
            "name": "status",
            "type": "string",
            "constraints": {
              "enum": [
                "todo",
                "doing",
                "done"
              ]
            }
          },
          {
            "id": "nqhx3hc8c9a4i",
            "name": "priority",
            "type": "integer",
            "constraints": {
              "minimum": 1,
              "maximum": 5
            }
          },
          {
            "id": "g9rhycojwqyba",
            "name": "assignee",
            "type": "string"
          }
        ],
        "primaryKey": [
          "title"
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "ytjc8tj8w8ftnbf9h86s5k9jfk",
          "title": "Land .table extension",
          "project": "1h38m5st7rwanz3hyjb6dy8igr",
          "status": "done",
          "priority": 1,
          "assignee": "leslie"
        },
        {
          "id": "wpzuom5b9k3k4g6co658ozwerw",
          "title": "Wire RSD + StyleX",
          "project": "1h38m5st7rwanz3hyjb6dy8igr",
          "status": "doing",
          "priority": 2,
          "assignee": "leslie"
        },
        {
          "id": "18pfutsbnrkppxrwxxn1ideokr",
          "title": "Fixtures + tests",
          "project": "1h38m5st7rwanz3hyjb6dy8igr",
          "status": "doing",
          "priority": 3,
          "assignee": "claude"
        },
        {
          "id": "7rese5ziapr9ih41puficyt9ay",
          "title": "Settings panel",
          "project": "xsdxifzn73ohismzm8q5uri8fe",
          "status": "todo",
          "priority": 2,
          "assignee": "leslie"
        },
        {
          "id": "imua9kjffc83wirjcotinputgj",
          "title": "Markdown editor polish",
          "project": "xsdxifzn73ohismzm8q5uri8fe",
          "status": "doing",
          "priority": 1,
          "assignee": "sam"
        },
        {
          "id": "abk93zgaattfxeony4hqsf457r",
          "title": "App icon",
          "project": "4csppbyqkcmq3kf4y7zbxeeumg",
          "status": "todo",
          "priority": 3,
          "assignee": "sam"
        },
        {
          "id": "3dk5j8ame7mcdhys4cnf47buka",
          "title": "Sync conflict resolution",
          "project": "o65fjfegds8n54xqbkg9hkf5cq",
          "status": "todo",
          "priority": 4,
          "assignee": "claude"
        },
        {
          "id": "36qw33ippkn6aue5er5hgt1scp",
          "title": "OG images",
          "project": "knapbng9n8qtguzrxfj7n6uudd",
          "status": "done",
          "priority": 5,
          "assignee": "sam"
        }
      ],
      "views": [
        {
          "id": "ffaisc1zows4dzhy7aq5jrebkx",
          "name": "All tasks by priority",
          "layout": "table",
          "sort": [
            {
              "field": "priority",
              "direction": "asc"
            }
          ]
        },
        {
          "id": "gzrqtgo1p3gfehto7tani3jzz4",
          "name": "Board by status",
          "layout": "board",
          "board_field": "status"
        }
      ],
      "meta": {
        "title": "Tasks"
      },
      "path": "fixtures/projects.table/tables/tasks",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "ytjc8tj8w8ftnbf9h86s5k9jfk",
            "wpzuom5b9k3k4g6co658ozwerw",
            "18pfutsbnrkppxrwxxn1ideokr",
            "7rese5ziapr9ih41puficyt9ay",
            "imua9kjffc83wirjcotinputgj",
            "abk93zgaattfxeony4hqsf457r",
            "3dk5j8ame7mcdhys4cnf47buka",
            "36qw33ippkn6aue5er5hgt1scp"
          ]
        }
      ]
    }
  },
  "path": "fixtures/projects.table"
};
