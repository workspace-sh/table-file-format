// Generated from fixtures/household-budget.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const householdBudgetBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Household budget",
    "description": "A quarter's budget laid out as a sheet, and a ledger with a running balance.",
    "tables": [
      "budget",
      "ledger"
    ],
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-29T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "tables": {
    "budget": {
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
            "description": "This row's Q1 as a share of the Income row's. In the sheet, typed in row 1 as =F1/$F$7: $F$7 pins the Income row by its id, so sorting never breaks it.",
            "computed": {
              "expr": "(/ quarter (field \"quarter\" \"income\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "spend",
            "type": "number",
            "title": "Spend",
            "format": "currency:GBP",
            "description": "Q1 for spending lines; nothing for income.",
            "computed": {
              "expr": "(if (= category \"Income\") 0 quarter)",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "of_spending",
            "type": "number",
            "title": "Of spending",
            "format": "percent",
            "description": "This line's share of the quarter's total spending: its Q1 over the whole Spend column (D36).",
            "computed": {
              "expr": "(if (<> category \"Income\") (/ quarter (sum (column \"spend\"))))",
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
            "item": 140,
            "category": 120,
            "jan": 130,
            "feb": 130,
            "mar": 130,
            "quarter": 145,
            "share": 90
          },
          "totals": {
            "jan": "sum",
            "feb": "sum",
            "mar": "sum",
            "quarter": "sum"
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
            "share",
            "of_spending"
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
        "title": "Household budget",
        "description": "A quarter's budget laid out as a sheet: formulas across months, and a share of the Income row.",
        "created_at": "2026-09-26T00:00:00Z",
        "modified_at": "2026-09-26T00:00:00Z"
      },
      "path": "fixtures/household-budget.table/tables/budget"
    },
    "ledger": {
      "schema": {
        "fields": [
          {
            "name": "date",
            "type": "date",
            "title": "Date",
            "constraints": {
              "required": true
            }
          },
          {
            "name": "item",
            "type": "string",
            "title": "Item"
          },
          {
            "name": "amount",
            "type": "number",
            "title": "Amount",
            "format": "currency:GBP",
            "description": "Money in is positive, money out negative."
          },
          {
            "name": "balance",
            "type": "number",
            "title": "Balance",
            "format": "currency:GBP",
            "description": "The running balance down the By date sheet: the balance in the row above plus this row's amount. Typed in row 2 of that sheet as =sum(D1, C2), and read by place, so it follows the dates however the rows were entered. sum treats the empty cell above row 1 as nothing.",
            "computed": {
              "expr": "(sum (at \"balance\" -1 \"by-date\") amount)",
              "dialect": "table-expr-v1"
            }
          }
        ]
      },
      "rows": [
        {
          "id": "opening",
          "date": "2026-01-01",
          "item": "Opening balance",
          "amount": 1200
        },
        {
          "id": "salary-jan",
          "date": "2026-01-28",
          "item": "Salary",
          "amount": 3600
        },
        {
          "id": "rent-jan",
          "date": "2026-01-02",
          "item": "Rent",
          "amount": -1450
        },
        {
          "id": "groceries-jan",
          "date": "2026-01-10",
          "item": "Groceries",
          "amount": -410
        },
        {
          "id": "energy-jan",
          "date": "2026-01-15",
          "item": "Energy",
          "amount": -142
        },
        {
          "id": "rent-feb",
          "date": "2026-02-02",
          "item": "Rent",
          "amount": -1450
        },
        {
          "id": "salary-feb",
          "date": "2026-02-27",
          "item": "Salary",
          "amount": 3600
        },
        {
          "id": "transport-feb",
          "date": "2026-02-12",
          "item": "Transport",
          "amount": -165
        },
        {
          "id": "eating-feb",
          "date": "2026-02-20",
          "item": "Eating out",
          "amount": -95
        },
        {
          "id": "savings-feb",
          "date": "2026-02-28",
          "item": "To savings",
          "amount": -500
        }
      ],
      "views": [
        {
          "id": "by-date",
          "name": "By date",
          "layout": "table",
          "coordinates": true,
          "sort": [
            {
              "field": "date",
              "direction": "asc"
            }
          ],
          "fields": [
            "date",
            "item",
            "amount",
            "balance"
          ],
          "columnWidths": {
            "date": 130,
            "item": 160,
            "amount": 130,
            "balance": 130
          }
        },
        {
          "id": "as-entered",
          "name": "As entered",
          "layout": "table",
          "fields": [
            "date",
            "item",
            "amount",
            "balance"
          ],
          "columnWidths": {
            "date": 130,
            "item": 160,
            "amount": 130,
            "balance": 130
          }
        }
      ],
      "meta": {
        "title": "Ledger",
        "description": "Money in and out, as entered, with a running balance down the By date sheet.",
        "created_at": "2026-09-29T00:00:00Z",
        "modified_at": "2026-09-29T00:00:00Z"
      },
      "path": "fixtures/household-budget.table/tables/ledger"
    }
  },
  "path": "fixtures/household-budget.table"
};
