// Generated from fixtures/contacts.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedTable } from "@workspace.sh/table-core";

export const contactsTable: ParsedTable = {
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
    "format": "table",
    "formatVersion": 1,
    "title": "Contacts",
    "description": "People at the companies in the CRM.",
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-26T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "path": "fixtures/contacts.table"
};
