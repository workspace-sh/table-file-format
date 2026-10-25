// Generated from fixtures/crm.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const crmBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
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
            "id": "rghwqogkxjjs8",
            "name": "name",
            "type": "string",
            "title": "Company",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "8c9dqd6zp7tyu",
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
            "id": "ctbjed8gnxh9z",
            "name": "website",
            "type": "string",
            "title": "Website",
            "format": "url"
          },
          {
            "id": "cbs3num9xuqbe",
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
            "id": "8kggyzjcrbp75",
            "name": "customer",
            "type": "boolean",
            "title": "Customer",
            "description": "Has signed at least one deal."
          },
          {
            "id": "rj9n8y9apsroy",
            "name": "employees",
            "type": "integer",
            "title": "Employees",
            "constraints": {
              "minimum": 1
            }
          },
          {
            "id": "gnsjpcnghb1xg",
            "name": "growth",
            "type": "number",
            "title": "Growth",
            "format": "percent",
            "description": "Headcount growth over the last year."
          },
          {
            "id": "pmiidt4zkgr5y",
            "name": "logo",
            "type": "string",
            "title": "Logo",
            "attachment": true
          },
          {
            "id": "pmf5osu9sjqmk",
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
            "id": "c84gaouo69mpf",
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
            "id": "jx6u8xw3y4u1a",
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
          "id": "znqnjiyryfpbdjfb57fzm6119k",
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
          "id": "yuj6mtu1akbnxbb5k9nmfrh5p6",
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
          "id": "wexwuo344aoowkqiieeb8fk56z",
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
          "id": "w5bqp8gjqebacfc6gnjgp93a98",
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
          "id": "ihka6ego6oyrkacacjngf3y7od",
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
          "id": "j3qx6ayq43nqjoogmd7b6jedyi",
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
          "id": "9gcz9d8ctoqamitkgwfhiu7sru",
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
          "id": "7cpm7hu37hhoyip8dqp5xrikgi",
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
          "id": "r13o6oqo7xmpbc7bdmo3t6zcgx",
          "name": "By industry",
          "layout": "board",
          "board_field": "industry",
          "fields": [
            "name",
            "employees"
          ]
        },
        {
          "id": "surkeym1tjrn97wm3xdrg9qufr",
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
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "znqnjiyryfpbdjfb57fzm6119k",
            "yuj6mtu1akbnxbb5k9nmfrh5p6",
            "wexwuo344aoowkqiieeb8fk56z",
            "w5bqp8gjqebacfc6gnjgp93a98",
            "ihka6ego6oyrkacacjngf3y7od",
            "j3qx6ayq43nqjoogmd7b6jedyi"
          ]
        }
      ],
      "bodies": {
        "wexwuo344aoowkqiieeb8fk56z": "# Atlas Freight\n\nOur largest account. Renewal talks start in Q4.\n\n- Champion: Maya Okafor\n- Risk: procurement wants a three-year term\n"
      }
    },
    "contacts": {
      "schema": {
        "fields": [
          {
            "id": "rghwqogkxjjs8",
            "name": "name",
            "type": "string",
            "title": "Name",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "mabuakau8tjug",
            "name": "company",
            "type": "string",
            "title": "Company",
            "relation": {
              "table": "companies",
              "field": "id"
            }
          },
          {
            "id": "rrw119rwcjag3",
            "name": "email",
            "type": "string",
            "title": "Email",
            "format": "email",
            "constraints": {
              "unique": true
            }
          },
          {
            "id": "ew5t3j3xky8qc",
            "name": "phone",
            "type": "string",
            "title": "Phone",
            "format": "phone",
            "description": "Stored as text: a phone number is not a number."
          },
          {
            "id": "8hq1hqqttndpp",
            "name": "role",
            "type": "string",
            "title": "Role"
          },
          {
            "id": "mbexdidzxnusp",
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
          "id": "3zaq9e5my1rrbywrdnfwsfcf4n",
          "name": "Maya Okafor",
          "company": "wexwuo344aoowkqiieeb8fk56z",
          "email": "maya@atlasfreight.example",
          "phone": "+44 20 7946 0101",
          "role": "Head of Operations",
          "last_contacted": "2026-09-22T14:30:00Z"
        },
        {
          "id": "7t7w54pit8zj8swt9ihwbfxbpb",
          "name": "Jonas Weber",
          "company": "wexwuo344aoowkqiieeb8fk56z",
          "email": "jonas@atlasfreight.example",
          "phone": "+49 30 901820",
          "role": "Procurement",
          "last_contacted": "2026-09-10T09:00:00Z"
        },
        {
          "id": "7xbtoiywn5ahzyyehydb8ds6fc",
          "name": "Priya Nair",
          "company": "znqnjiyryfpbdjfb57fzm6119k",
          "email": "priya@northwind.example",
          "phone": "+1 415 555 0142",
          "role": "Buyer",
          "last_contacted": "2026-09-18T16:15:00Z"
        },
        {
          "id": "tug935z61my86gih83fu8gyd4o",
          "name": "Sam Carter",
          "company": "yuj6mtu1akbnxbb5k9nmfrh5p6",
          "email": "sam@lumenhealth.example",
          "phone": "+1 212 555 0199",
          "role": "CTO",
          "last_contacted": "2026-08-30T11:00:00Z"
        },
        {
          "id": "6rq1xikzpbz5wrsspdg7faqrku",
          "name": "Inês Duarte",
          "company": "ihka6ego6oyrkacacjngf3y7od",
          "email": "ines@tidal.example",
          "phone": "+351 21 555 0123",
          "role": "Partnerships",
          "last_contacted": "2026-09-25T10:45:00Z"
        },
        {
          "id": "xffpuxujsk76qitnr9fr1xo7f7",
          "name": "Léo Martin",
          "company": "w5bqp8gjqebacfc6gnjgp93a98",
          "email": "leo@quill.example",
          "phone": "+33 1 55 55 01 23",
          "role": "Founder",
          "last_contacted": "2026-07-14T13:20:00Z"
        },
        {
          "id": "8i1cnu1czbitbof4e5ezitpht3",
          "name": "Ada Lindqvist",
          "company": "j3qx6ayq43nqjoogmd7b6jedyi",
          "email": "ada@fernstudio.example",
          "phone": "+46 8 555 010 10",
          "role": "Studio lead",
          "last_contacted": "2026-09-01T08:30:00Z"
        },
        {
          "id": "pd3c7tryk9dq3p5obiywnish9h",
          "name": "Kofi Mensah",
          "company": "ihka6ego6oyrkacacjngf3y7od",
          "email": "kofi@tidal.example",
          "phone": "+233 30 255 0101",
          "role": "Finance",
          "last_contacted": "2026-09-24T15:00:00Z"
        }
      ],
      "views": [
        {
          "id": "9gcz9d8ctoqamitkgwfhiu7sru",
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
          "id": "wa68ong5p9463hzwn1wngk1yrh",
          "name": "Call list",
          "layout": "list",
          "fields": [
            "name",
            "phone",
            "company"
          ],
          "order": [
            "3zaq9e5my1rrbywrdnfwsfcf4n",
            "6rq1xikzpbz5wrsspdg7faqrku",
            "pd3c7tryk9dq3p5obiywnish9h",
            "7xbtoiywn5ahzyyehydb8ds6fc"
          ]
        }
      ],
      "meta": {
        "title": "Contacts",
        "description": "People at the companies in the CRM.",
        "created_at": "2026-09-26T00:00:00Z",
        "modified_at": "2026-09-26T00:00:00Z"
      },
      "path": "fixtures/crm.table/tables/contacts",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "3zaq9e5my1rrbywrdnfwsfcf4n",
            "7t7w54pit8zj8swt9ihwbfxbpb",
            "7xbtoiywn5ahzyyehydb8ds6fc",
            "tug935z61my86gih83fu8gyd4o",
            "6rq1xikzpbz5wrsspdg7faqrku",
            "xffpuxujsk76qitnr9fr1xo7f7",
            "8i1cnu1czbitbof4e5ezitpht3",
            "pd3c7tryk9dq3p5obiywnish9h"
          ]
        }
      ]
    },
    "deals": {
      "schema": {
        "fields": [
          {
            "id": "j49tkemwbf17r",
            "name": "title",
            "type": "string",
            "title": "Deal",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "mabuakau8tjug",
            "name": "company",
            "type": "string",
            "title": "Company",
            "relation": {
              "table": "companies",
              "field": "id"
            }
          },
          {
            "id": "pbpftmn36sxnq",
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
            "id": "md7yzo3kw3d81",
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
            "id": "yenis3phpcrn1",
            "name": "value",
            "type": "number",
            "title": "Value",
            "format": "currency:USD",
            "align": "end"
          },
          {
            "id": "gqhzunramagty",
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
            "id": "x638q3pmppoye",
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
            "id": "ckjab9fcna5nf",
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
            "id": "r57wxgpofr4hg",
            "name": "close_date",
            "type": "date",
            "title": "Close date"
          },
          {
            "id": "gm95w4ffnqbgi",
            "name": "renewal",
            "type": "boolean",
            "title": "Renewal"
          },
          {
            "id": "cbs3num9xuqbe",
            "name": "industry",
            "type": "string",
            "title": "Industry",
            "description": "Looked up from the deal's company (D36).",
            "computed": {
              "expr": "(related \"company\" \"industry\")",
              "dialect": "table-expr-v1"
            }
          },
          {
            "id": "nczi59m8iph3w",
            "name": "company_pipeline",
            "type": "number",
            "title": "Company pipeline",
            "description": "The company's whole open pipeline: its rollup of every open deal, this one included (#123).",
            "format": "currency:USD",
            "computed": {
              "expr": "(related \"company\" \"open_pipeline\")",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "jddy8scd44w9r1kqur3j4meoii",
          "title": "Atlas: 3-year renewal",
          "company": "wexwuo344aoowkqiieeb8fk56z",
          "contacts": [
            "3zaq9e5my1rrbywrdnfwsfcf4n",
            "7t7w54pit8zj8swt9ihwbfxbpb"
          ],
          "stage": "negotiation",
          "value": 180000,
          "probability": 0.7,
          "close_date": "2026-10-30",
          "renewal": true
        },
        {
          "id": "neh69ghtrhcnhgnbbzqnfwjb4h",
          "title": "Northwind: store rollout",
          "company": "znqnjiyryfpbdjfb57fzm6119k",
          "contacts": [
            "7xbtoiywn5ahzyyehydb8ds6fc"
          ],
          "stage": "proposal",
          "value": 64000,
          "probability": 0.4,
          "close_date": "2026-11-14",
          "renewal": false
        },
        {
          "id": "gpfguzziutn64mew4ecgey6rkz",
          "title": "Lumen: pilot",
          "company": "yuj6mtu1akbnxbb5k9nmfrh5p6",
          "contacts": [
            "tug935z61my86gih83fu8gyd4o"
          ],
          "stage": "qualified",
          "value": 22000,
          "probability": 0.25,
          "close_date": "2026-12-05",
          "renewal": false
        },
        {
          "id": "x4ch1jcqawdk7y1e7i9hzu9piu",
          "title": "Tidal: grid analytics",
          "company": "ihka6ego6oyrkacacjngf3y7od",
          "contacts": [
            "6rq1xikzpbz5wrsspdg7faqrku",
            "pd3c7tryk9dq3p5obiywnish9h"
          ],
          "stage": "won",
          "value": 96000,
          "probability": 1,
          "close_date": "2026-09-12",
          "renewal": false
        },
        {
          "id": "mig4q54k4a75gcqa5x916yxizf",
          "title": "Quill: newsroom seats",
          "company": "w5bqp8gjqebacfc6gnjgp93a98",
          "contacts": [
            "xffpuxujsk76qitnr9fr1xo7f7"
          ],
          "stage": "lost",
          "value": 12000,
          "probability": 0,
          "close_date": "2026-08-28",
          "renewal": false
        },
        {
          "id": "4j8dtp7k1t8aspbaoty3wyzbac",
          "title": "Fern: studio plan",
          "company": "j3qx6ayq43nqjoogmd7b6jedyi",
          "contacts": [
            "8i1cnu1czbitbof4e5ezitpht3"
          ],
          "stage": "lead",
          "value": 4800,
          "probability": 0.1,
          "close_date": "2026-12-20",
          "renewal": false
        },
        {
          "id": "gaa48gxz31obqmgf3amrad45xk",
          "title": "Atlas: EU expansion",
          "company": "wexwuo344aoowkqiieeb8fk56z",
          "contacts": [
            "3zaq9e5my1rrbywrdnfwsfcf4n"
          ],
          "stage": "lead",
          "value": 250000,
          "probability": 0.1,
          "close_date": "2027-02-01",
          "renewal": false
        },
        {
          "id": "ijfqsuz3j8oyju3imqb9b37uq6",
          "title": "Tidal: renewal",
          "company": "ihka6ego6oyrkacacjngf3y7od",
          "contacts": [
            "pd3c7tryk9dq3p5obiywnish9h"
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
          "id": "oxycwiuri87bqu1s89cpt836n1",
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
          "id": "hc9yis984a6wnajx7rgoi476ay",
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
          "id": "oztz56jo4yid66csmo63wamhsn",
          "name": "Closing",
          "layout": "calendar",
          "calendar_field": "close_date"
        },
        {
          "id": "9gcz9d8ctoqamitkgwfhiu7sru",
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
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "jddy8scd44w9r1kqur3j4meoii",
            "neh69ghtrhcnhgnbbzqnfwjb4h",
            "gpfguzziutn64mew4ecgey6rkz",
            "x4ch1jcqawdk7y1e7i9hzu9piu",
            "mig4q54k4a75gcqa5x916yxizf",
            "4j8dtp7k1t8aspbaoty3wyzbac",
            "gaa48gxz31obqmgf3amrad45xk",
            "ijfqsuz3j8oyju3imqb9b37uq6"
          ]
        }
      ],
      "bodies": {
        "jddy8scd44w9r1kqur3j4meoii": "# Atlas: 3-year renewal\n\nThey want a three-year term with a price lock.\n\n## Next\n\n1. Legal review of the MSA\n2. Security questionnaire\n"
      }
    }
  },
  "path": "fixtures/crm.table"
};
