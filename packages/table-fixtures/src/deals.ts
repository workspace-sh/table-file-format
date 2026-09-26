// Generated from fixtures/deals.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedTable } from "@workspace.sh/table-core";

export const dealsTable: ParsedTable = {
  "schema": {
    "fields": [
      {
        "name": "title",
        "type": "string",
        "title": "Deal",
        "constraints": {
          "required": true
        }
      },
      {
        "name": "company",
        "type": "string",
        "title": "Company",
        "relation": {
          "table": "companies",
          "field": "id"
        }
      },
      {
        "name": "contacts",
        "type": "array",
        "title": "Contacts",
        "relation": {
          "table": "contacts",
          "field": "id",
          "cardinality": "many"
        }
      },
      {
        "name": "stage",
        "type": "string",
        "title": "Stage",
        "constraints": {
          "enum": [
            {
              "value": "lead",
              "label": "Lead",
              "color": "gray"
            },
            {
              "value": "qualified",
              "label": "Qualified",
              "color": "blue"
            },
            {
              "value": "proposal",
              "label": "Proposal",
              "color": "purple"
            },
            {
              "value": "negotiation",
              "label": "Negotiation",
              "color": "orange"
            },
            {
              "value": "won",
              "label": "Won",
              "color": "green"
            },
            {
              "value": "lost",
              "label": "Lost",
              "color": "red"
            }
          ],
          "required": true
        }
      },
      {
        "name": "value",
        "type": "number",
        "title": "Value",
        "format": "currency:USD",
        "align": "right"
      },
      {
        "name": "probability",
        "type": "number",
        "title": "Probability",
        "format": "percent",
        "constraints": {
          "minimum": 0,
          "maximum": 1
        }
      },
      {
        "name": "weighted",
        "type": "number",
        "title": "Weighted",
        "description": "Value times probability: what the deal is worth to the forecast.",
        "computed": {
          "expr": "(round (* value probability) 0)",
          "dialect": "table-expr-v1"
        }
      },
      {
        "name": "open_value",
        "type": "number",
        "title": "Open value",
        "description": "The deal's value while it's still open; nothing once it's won or lost.",
        "computed": {
          "expr": "(if (or (= stage \"won\") (= stage \"lost\")) 0 value)",
          "dialect": "table-expr-v1"
        }
      },
      {
        "name": "close_date",
        "type": "date",
        "title": "Close date"
      },
      {
        "name": "renewal",
        "type": "boolean",
        "title": "Renewal"
      },
      {
        "name": "industry",
        "type": "string",
        "title": "Industry",
        "description": "Looked up from the deal's company (D36).",
        "computed": {
          "expr": "(lookup \"company\" \"industry\")",
          "dialect": "table-expr-v1"
        }
      }
    ],
    "schema-version": 1
  },
  "rows": [
    {
      "id": "dl-1",
      "title": "Atlas: 3-year renewal",
      "company": "co-atlas",
      "contacts": [
        "ct-maya",
        "ct-jonas"
      ],
      "stage": "negotiation",
      "value": 180000,
      "probability": 0.7,
      "close_date": "2026-10-30",
      "renewal": true
    },
    {
      "id": "dl-2",
      "title": "Northwind: store rollout",
      "company": "co-northwind",
      "contacts": [
        "ct-priya"
      ],
      "stage": "proposal",
      "value": 64000,
      "probability": 0.4,
      "close_date": "2026-11-14",
      "renewal": false
    },
    {
      "id": "dl-3",
      "title": "Lumen: pilot",
      "company": "co-lumen",
      "contacts": [
        "ct-sam"
      ],
      "stage": "qualified",
      "value": 22000,
      "probability": 0.25,
      "close_date": "2026-12-05",
      "renewal": false
    },
    {
      "id": "dl-4",
      "title": "Tidal: grid analytics",
      "company": "co-tidal",
      "contacts": [
        "ct-ines",
        "ct-kofi"
      ],
      "stage": "won",
      "value": 96000,
      "probability": 1,
      "close_date": "2026-09-12",
      "renewal": false
    },
    {
      "id": "dl-5",
      "title": "Quill: newsroom seats",
      "company": "co-quill",
      "contacts": [
        "ct-leo"
      ],
      "stage": "lost",
      "value": 12000,
      "probability": 0,
      "close_date": "2026-08-28",
      "renewal": false
    },
    {
      "id": "dl-6",
      "title": "Fern: studio plan",
      "company": "co-fern",
      "contacts": [
        "ct-ada"
      ],
      "stage": "lead",
      "value": 4800,
      "probability": 0.1,
      "close_date": "2026-12-20",
      "renewal": false
    },
    {
      "id": "dl-7",
      "title": "Atlas: EU expansion",
      "company": "co-atlas",
      "contacts": [
        "ct-maya"
      ],
      "stage": "lead",
      "value": 250000,
      "probability": 0.1,
      "close_date": "2027-02-01",
      "renewal": false
    },
    {
      "id": "dl-8",
      "title": "Tidal: renewal",
      "company": "co-tidal",
      "contacts": [
        "ct-kofi"
      ],
      "stage": "proposal",
      "value": 104000,
      "probability": 0.5,
      "close_date": "2026-11-28",
      "renewal": true
    }
  ],
  "views": [
    {
      "id": "pipeline",
      "name": "Pipeline",
      "layout": "board",
      "board_field": "stage",
      "fields": [
        "title",
        "company",
        "value",
        "close_date"
      ]
    },
    {
      "id": "open",
      "name": "Open deals",
      "layout": "table",
      "filter": [
        {
          "field": "stage",
          "operator": "not_in",
          "value": [
            "won",
            "lost"
          ]
        }
      ],
      "sort": [
        {
          "field": "weighted",
          "direction": "desc"
        }
      ]
    },
    {
      "id": "closing",
      "name": "Closing",
      "layout": "calendar",
      "calendar_field": "close_date"
    },
    {
      "id": "all",
      "name": "All deals",
      "layout": "table",
      "totals": {
        "title": "count",
        "value": "sum",
        "weighted": "sum"
      }
    }
  ],
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Deals",
    "description": "A sales pipeline linked to companies and contacts.",
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-26T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "path": "fixtures/deals.table",
  "bodies": {
    "dl-1": "# Atlas: 3-year renewal\n\nThey want a three-year term with a price lock.\n\n## Next\n\n1. Legal review of the MSA\n2. Security questionnaire\n"
  }
};
