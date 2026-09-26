// Generated from fixtures/companies.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedTable } from "@workspace.sh/table-core";

export const companiesTable: ParsedTable = {
  "schema": {
    "fields": [
      {
        "name": "name",
        "type": "string",
        "title": "Company",
        "constraints": {
          "required": true
        }
      },
      {
        "name": "domain",
        "type": "string",
        "title": "Domain",
        "description": "The company's web domain, lowercase, without https://.",
        "constraints": {
          "unique": true,
          "pattern": "^[a-z0-9-]+(\\.[a-z0-9-]+)+$"
        }
      },
      {
        "name": "website",
        "type": "string",
        "title": "Website",
        "format": "url"
      },
      {
        "name": "industry",
        "type": "string",
        "title": "Industry",
        "icon": "🏷️",
        "constraints": {
          "enum": [
            {
              "value": "Retail",
              "color": "orange"
            },
            {
              "value": "Healthcare",
              "color": "green"
            },
            {
              "value": "Logistics",
              "color": "blue"
            },
            {
              "value": "Media",
              "color": "purple"
            },
            {
              "value": "Energy",
              "color": "yellow"
            },
            {
              "value": "Design",
              "color": "pink"
            }
          ]
        }
      },
      {
        "name": "customer",
        "type": "boolean",
        "title": "Customer",
        "description": "Has signed at least one deal."
      },
      {
        "name": "employees",
        "type": "integer",
        "title": "Employees",
        "constraints": {
          "minimum": 1
        }
      },
      {
        "name": "growth",
        "type": "number",
        "title": "Growth",
        "format": "percent",
        "description": "Headcount growth over the last year."
      },
      {
        "name": "logo",
        "type": "string",
        "title": "Logo",
        "attachment": true
      },
      {
        "name": "tags",
        "type": "array",
        "title": "Tags",
        "description": "Free tags. A choice list for these needs multi-select (not yet in the format)."
      }
    ],
    "schema-version": 1
  },
  "rows": [
    {
      "id": "co-northwind",
      "name": "Northwind Traders",
      "domain": "northwind.example",
      "website": "https://northwind.example",
      "industry": "Retail",
      "customer": true,
      "employees": 240,
      "growth": 0.12,
      "logo": "co-northwind.svg",
      "tags": [
        "wholesale",
        "emea"
      ]
    },
    {
      "id": "co-lumen",
      "name": "Lumen Health",
      "domain": "lumenhealth.example",
      "website": "https://lumenhealth.example",
      "industry": "Healthcare",
      "customer": false,
      "employees": 85,
      "growth": 0.31,
      "logo": "co-lumen.svg",
      "tags": [
        "clinics"
      ]
    },
    {
      "id": "co-atlas",
      "name": "Atlas Freight",
      "domain": "atlasfreight.example",
      "website": "https://atlasfreight.example",
      "industry": "Logistics",
      "customer": true,
      "employees": 1200,
      "growth": 0.04,
      "logo": "co-atlas.svg",
      "tags": [
        "enterprise",
        "emea",
        "priority"
      ]
    },
    {
      "id": "co-quill",
      "name": "Quill & Co",
      "domain": "quill.example",
      "website": "https://quill.example",
      "industry": "Media",
      "customer": false,
      "employees": 18,
      "growth": 0.55,
      "logo": "co-quill.svg",
      "tags": [
        "startup"
      ]
    },
    {
      "id": "co-tidal",
      "name": "Tidal Energy",
      "domain": "tidal.example",
      "website": "https://tidal.example",
      "industry": "Energy",
      "customer": true,
      "employees": 430,
      "growth": 0.08,
      "logo": "co-tidal.svg",
      "tags": [
        "enterprise",
        "renewables"
      ]
    },
    {
      "id": "co-fern",
      "name": "Fern Studio",
      "domain": "fernstudio.example",
      "website": "https://fernstudio.example",
      "industry": "Design",
      "customer": false,
      "employees": 9,
      "growth": 0.67,
      "logo": "co-fern.svg",
      "tags": [
        "startup",
        "agency"
      ]
    }
  ],
  "views": [
    {
      "id": "all",
      "name": "All companies",
      "layout": "table",
      "fields": [
        "name",
        "industry",
        "customer",
        "employees",
        "growth",
        "domain",
        "tags"
      ],
      "columnWidths": {
        "name": 220
      },
      "rowHeight": 44
    },
    {
      "id": "logos",
      "name": "Logos",
      "layout": "gallery",
      "gallery_field": "logo",
      "fields": [
        "name",
        "industry",
        "website"
      ]
    },
    {
      "id": "by-industry",
      "name": "By industry",
      "layout": "board",
      "board_field": "industry",
      "fields": [
        "name",
        "employees"
      ]
    },
    {
      "id": "customers",
      "name": "Customers",
      "layout": "table",
      "filter": [
        {
          "field": "customer",
          "operator": "eq",
          "value": true
        }
      ],
      "sort": [
        {
          "field": "employees",
          "direction": "desc"
        }
      ]
    }
  ],
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Companies",
    "description": "Accounts in a small CRM: Notion / Airtable style.",
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-26T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "path": "fixtures/companies.table",
  "bodies": {
    "co-atlas": "# Atlas Freight\n\nOur largest account. Renewal talks start in Q4.\n\n- Champion: Maya Okafor\n- Risk: procurement wants a three-year term\n"
  }
};
