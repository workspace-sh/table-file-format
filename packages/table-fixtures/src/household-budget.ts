// Generated from fixtures/household-budget.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedTable } from "@workspace.sh/table-core";

export const householdBudgetTable: ParsedTable = {
  "schema": {
    "fields": [
      {
        "name": "item",
        "type": "string",
        "title": "Item",
        "constraints": {
          "required": true
        }
      },
      {
        "name": "category",
        "type": "string",
        "title": "Category",
        "constraints": {
          "enum": [
            {
              "value": "Housing",
              "color": "blue"
            },
            {
              "value": "Food",
              "color": "green"
            },
            {
              "value": "Transport",
              "color": "orange"
            },
            {
              "value": "Fun",
              "color": "pink"
            },
            {
              "value": "Savings",
              "color": "purple"
            },
            {
              "value": "Income",
              "color": "gray"
            }
          ]
        }
      },
      {
        "name": "jan",
        "type": "number",
        "title": "Jan",
        "format": "currency:GBP"
      },
      {
        "name": "feb",
        "type": "number",
        "title": "Feb",
        "format": "currency:GBP"
      },
      {
        "name": "mar",
        "type": "number",
        "title": "Mar",
        "format": "currency:GBP"
      },
      {
        "name": "quarter",
        "type": "number",
        "title": "Q1",
        "description": "January to March. In the sheet, typed in row 1 as =C1+D1+E1: its own row's months, so every row adds up its own.",
        "computed": {
          "expr": "(+ jan feb mar)",
          "dialect": "table-expr-v1"
        }
      },
      {
        "name": "share",
        "type": "number",
        "title": "Share",
        "format": "percent",
        "description": "This row's Q1 as a share of the Income row's. In the sheet, typed in row 1 as =F1/F7: F7 is the Income row, stored by its id, so sorting never breaks it.",
        "computed": {
          "expr": "(/ quarter (field \"quarter\" \"income\"))",
          "dialect": "table-expr-v1"
        }
      }
    ],
    "schema-version": 1
  },
  "rows": [
    {
      "id": "rent",
      "item": "Rent",
      "category": "Housing",
      "jan": 1450,
      "feb": 1450,
      "mar": 1450
    },
    {
      "id": "energy",
      "item": "Energy",
      "category": "Housing",
      "jan": 142,
      "feb": 131,
      "mar": 118
    },
    {
      "id": "groceries",
      "item": "Groceries",
      "category": "Food",
      "jan": 410,
      "feb": 385,
      "mar": 402
    },
    {
      "id": "eating-out",
      "item": "Eating out",
      "category": "Fun",
      "jan": 120,
      "feb": 95,
      "mar": 150
    },
    {
      "id": "transport",
      "item": "Transport",
      "category": "Transport",
      "jan": 165,
      "feb": 165,
      "mar": 180
    },
    {
      "id": "savings",
      "item": "Savings",
      "category": "Savings",
      "jan": 500,
      "feb": 500,
      "mar": 500
    },
    {
      "id": "income",
      "item": "Income",
      "category": "Income",
      "jan": 3600,
      "feb": 3600,
      "mar": 3750
    }
  ],
  "views": [
    {
      "id": "sheet",
      "name": "Sheet",
      "layout": "table",
      "coordinates": true,
      "fields": [
        "item",
        "category",
        "jan",
        "feb",
        "mar",
        "quarter",
        "share"
      ],
      "columnWidths": {
        "item": 150,
        "category": 130,
        "jan": 110,
        "feb": 110,
        "mar": 110,
        "quarter": 120,
        "share": 110
      }
    },
    {
      "id": "spending",
      "name": "Spending",
      "layout": "table",
      "filter": [
        {
          "field": "category",
          "operator": "neq",
          "value": "Income"
        }
      ],
      "sort": [
        {
          "field": "quarter",
          "direction": "desc"
        }
      ],
      "fields": [
        "item",
        "category",
        "quarter",
        "share"
      ]
    },
    {
      "id": "by-category",
      "name": "By category",
      "layout": "board",
      "board_field": "category",
      "fields": [
        "item",
        "quarter"
      ]
    }
  ],
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Household budget",
    "description": "A quarter's budget laid out as a sheet: formulas across months, and a share of the Income row.",
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-26T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "path": "fixtures/household-budget.table"
};
