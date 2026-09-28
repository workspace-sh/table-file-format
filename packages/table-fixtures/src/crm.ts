// Generated from fixtures/crm.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const crmBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "CRM",
    "description": "Companies, the people there, and the deals in progress.",
    "tables": [
      "companies",
      "contacts",
      "deals"
    ],
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-26T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "tables": {
    "companies": {
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
            "description": "A multi-select: any number of these tags (D35).",
            "constraints": {
              "enum": [
                {
                  "value": "enterprise",
                  "color": "blue"
                },
                {
                  "value": "startup",
                  "color": "green"
                },
                {
                  "value": "agency",
                  "color": "pink"
                },
                {
                  "value": "emea",
                  "color": "purple"
                },
                {
                  "value": "priority",
                  "color": "red"
                },
                {
                  "value": "wholesale",
                  "color": "orange"
                },
                {
                  "value": "clinics",
                  "color": "yellow"
                },
                {
                  "value": "renewables",
                  "color": "gray"
                }
              ]
            }
          },
          {
            "name": "open_pipeline",
            "type": "number",
            "title": "Open pipeline",
            "format": "currency:USD",
            "description": "The sum of this company's open deals: a rollup over the deals that link here (D36).",
            "computed": {
              "expr": "(sum (linked \"deals\" \"company\" \"open_value\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "deal_count",
            "type": "number",
            "title": "Deals",
            "description": "How many deals link to this company.",
            "computed": {
              "expr": "(count (linked \"deals\" \"company\" \"title\"))",
              "dialect": "table-expr-v1"
            }
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
            "tags",
            "open_pipeline",
            "deal_count"
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
        "title": "Companies",
        "description": "Accounts in a small CRM: Notion / Airtable style.",
        "created_at": "2026-09-26T00:00:00Z",
        "modified_at": "2026-09-26T00:00:00Z"
      },
      "path": "fixtures/crm.table/tables/companies",
      "bodies": {
        "co-atlas": "# Atlas Freight\n\nOur largest account. Renewal talks start in Q4.\n\n- Champion: Maya Okafor\n- Risk: procurement wants a three-year term\n"
      }
    },
    "contacts": {
      "schema": {
        "fields": [
          {
            "name": "name",
            "type": "string",
            "title": "Name",
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
            "name": "email",
            "type": "string",
            "title": "Email",
            "format": "email",
            "constraints": {
              "unique": true
            }
          },
          {
            "name": "phone",
            "type": "string",
            "title": "Phone",
            "format": "phone",
            "description": "Stored as text: a phone number is not a number."
          },
          {
            "name": "role",
            "type": "string",
            "title": "Role"
          },
          {
            "name": "last_contacted",
            "type": "datetime",
            "title": "Last contacted",
            "format": "relative"
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "ct-maya",
          "name": "Maya Okafor",
          "company": "co-atlas",
          "email": "maya@atlasfreight.example",
          "phone": "+44 20 7946 0101",
          "role": "Head of Operations",
          "last_contacted": "2026-09-22T14:30:00Z"
        },
        {
          "id": "ct-jonas",
          "name": "Jonas Weber",
          "company": "co-atlas",
          "email": "jonas@atlasfreight.example",
          "phone": "+49 30 901820",
          "role": "Procurement",
          "last_contacted": "2026-09-10T09:00:00Z"
        },
        {
          "id": "ct-priya",
          "name": "Priya Nair",
          "company": "co-northwind",
          "email": "priya@northwind.example",
          "phone": "+1 415 555 0142",
          "role": "Buyer",
          "last_contacted": "2026-09-18T16:15:00Z"
        },
        {
          "id": "ct-sam",
          "name": "Sam Carter",
          "company": "co-lumen",
          "email": "sam@lumenhealth.example",
          "phone": "+1 212 555 0199",
          "role": "CTO",
          "last_contacted": "2026-08-30T11:00:00Z"
        },
        {
          "id": "ct-ines",
          "name": "Inês Duarte",
          "company": "co-tidal",
          "email": "ines@tidal.example",
          "phone": "+351 21 555 0123",
          "role": "Partnerships",
          "last_contacted": "2026-09-25T10:45:00Z"
        },
        {
          "id": "ct-leo",
          "name": "Léo Martin",
          "company": "co-quill",
          "email": "leo@quill.example",
          "phone": "+33 1 55 55 01 23",
          "role": "Founder",
          "last_contacted": "2026-07-14T13:20:00Z"
        },
        {
          "id": "ct-ada",
          "name": "Ada Lindqvist",
          "company": "co-fern",
          "email": "ada@fernstudio.example",
          "phone": "+46 8 555 010 10",
          "role": "Studio lead",
          "last_contacted": "2026-09-01T08:30:00Z"
        },
        {
          "id": "ct-kofi",
          "name": "Kofi Mensah",
          "company": "co-tidal",
          "email": "kofi@tidal.example",
          "phone": "+233 30 255 0101",
          "role": "Finance",
          "last_contacted": "2026-09-24T15:00:00Z"
        }
      ],
      "views": [
        {
          "id": "all",
          "name": "All contacts",
          "layout": "table",
          "sort": [
            {
              "field": "last_contacted",
              "direction": "desc"
            }
          ]
        },
        {
          "id": "call-list",
          "name": "Call list",
          "layout": "list",
          "fields": [
            "name",
            "phone",
            "company"
          ],
          "order": [
            "ct-maya",
            "ct-ines",
            "ct-kofi",
            "ct-priya"
          ]
        }
      ],
      "meta": {
        "title": "Contacts",
        "description": "People at the companies in the CRM.",
        "created_at": "2026-09-26T00:00:00Z",
        "modified_at": "2026-09-26T00:00:00Z"
      },
      "path": "fixtures/crm.table/tables/contacts"
    },
    "deals": {
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
            "align": "end"
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
          },
          {
            "name": "company_pipeline",
            "type": "number",
            "title": "Company pipeline",
            "description": "The company's whole open pipeline: its rollup of every open deal, this one included (#123).",
            "format": "currency:USD",
            "computed": {
              "expr": "(lookup \"company\" \"open_pipeline\")",
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
        "title": "Deals",
        "description": "A sales pipeline linked to companies and contacts.",
        "created_at": "2026-09-26T00:00:00Z",
        "modified_at": "2026-09-26T00:00:00Z"
      },
      "path": "fixtures/crm.table/tables/deals",
      "bodies": {
        "dl-1": "# Atlas: 3-year renewal\n\nThey want a three-year term with a price lock.\n\n## Next\n\n1. Legal review of the MSA\n2. Security questionnaire\n"
      }
    }
  },
  "path": "fixtures/crm.table"
};
