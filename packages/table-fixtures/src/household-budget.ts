// Generated from fixtures/household-budget.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const householdBudgetBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
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
            "id": "yy5drhhq5u1dz",
            "name": "item",
            "type": "string",
            "title": "Item",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "eszjd9en1u3er",
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
            "id": "earkzrfi77x7y",
            "name": "jan",
            "type": "number",
            "title": "Jan",
            "format": "currency:GBP"
          },
          {
            "id": "dbyyda85ram1b",
            "name": "feb",
            "type": "number",
            "title": "Feb",
            "format": "currency:GBP"
          },
          {
            "id": "g3t3wtejisupo",
            "name": "mar",
            "type": "number",
            "title": "Mar",
            "format": "currency:GBP"
          },
          {
            "id": "87hkfpyh4bnhx",
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
            "id": "qcciqt6okp8ub",
            "name": "share",
            "type": "number",
            "title": "Share",
            "format": "percent",
            "description": "This row's Q1 as a share of the Income row's. In the sheet, typed in row 1 as =F1/$F$7: $F$7 pins the Income row by its id, so sorting never breaks it.",
            "computed": {
              "expr": "(/ quarter (field \"quarter\" \"d7obaaj5dfw5bexxt8xmgrwbra\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "id": "mkt8w7zz1ayy7",
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
            "id": "f47epm8m9qd95",
            "name": "of_spending",
            "type": "number",
            "title": "Of spending",
            "format": "percent",
            "description": "This line's share of the quarter's total spending: its Q1 over the whole Spend column (D36).",
            "computed": {
              "expr": "(if (<> category \"Income\") (/ quarter (sum (values \"spend\"))))",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "yzqhrmxgwi1k3ur81b7epdbim5",
          "item": "Rent",
          "category": "Housing",
          "jan": 1450,
          "feb": 1450,
          "mar": 1450
        },
        {
          "id": "f8o7dzw4cpk4zgd38togwz7n4w",
          "item": "Energy",
          "category": "Housing",
          "jan": 142,
          "feb": 131,
          "mar": 118
        },
        {
          "id": "gkr1q69yxhwfb3ju1u961igyy8",
          "item": "Groceries",
          "category": "Food",
          "jan": 410,
          "feb": 385,
          "mar": 402
        },
        {
          "id": "8kz9mwsfj94jd1s7mbsfj3wnqu",
          "item": "Eating out",
          "category": "Fun",
          "jan": 120,
          "feb": 95,
          "mar": 150
        },
        {
          "id": "uzyms6k7fey4gpd9w4thfj14oc",
          "item": "Transport",
          "category": "Transport",
          "jan": 165,
          "feb": 165,
          "mar": 180
        },
        {
          "id": "tmxoh9ws9jj55x3rdgaskdojam",
          "item": "Savings",
          "category": "Savings",
          "jan": 500,
          "feb": 500,
          "mar": 500
        },
        {
          "id": "d7obaaj5dfw5bexxt8xmgrwbra",
          "item": "Income",
          "category": "Income",
          "jan": 3600,
          "feb": 3600,
          "mar": 3750
        }
      ],
      "views": [
        {
          "id": "kifpjiq34nhz8k95rc3uezwqu5",
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
          "id": "wsohm6y8imnngf9dirsm38je7w",
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
          "id": "c7ae39md7putcu3qkdfiitc1z1",
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
      "path": "fixtures/household-budget.table/tables/budget",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "yzqhrmxgwi1k3ur81b7epdbim5",
            "f8o7dzw4cpk4zgd38togwz7n4w",
            "gkr1q69yxhwfb3ju1u961igyy8",
            "8kz9mwsfj94jd1s7mbsfj3wnqu",
            "uzyms6k7fey4gpd9w4thfj14oc",
            "tmxoh9ws9jj55x3rdgaskdojam",
            "d7obaaj5dfw5bexxt8xmgrwbra"
          ]
        }
      ]
    },
    "ledger": {
      "schema": {
        "fields": [
          {
            "id": "kaomy8kbn9pfk",
            "name": "date",
            "type": "date",
            "title": "Date",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "yy5drhhq5u1dz",
            "name": "item",
            "type": "string",
            "title": "Item"
          },
          {
            "id": "pbbjj1y86736f",
            "name": "amount",
            "type": "number",
            "title": "Amount",
            "format": "currency:GBP",
            "description": "Money in is positive, money out negative."
          },
          {
            "id": "xygoknprkk9ku",
            "name": "balance",
            "type": "number",
            "title": "Balance",
            "format": "currency:GBP",
            "description": "The running balance down the By date sheet: the balance in the row above plus this row's amount. Typed in row 2 of that sheet as =sum(D1, C2), and read by place, so it follows the dates however the rows were entered. sum treats the empty cell above row 1 as nothing.",
            "computed": {
              "expr": "(sum (at \"balance\" -1 \"7wxsrxd9g5oa5smry9tmfahdzs\") amount)",
              "dialect": "table-expr-v1"
            }
          }
        ]
      },
      "rows": [
        {
          "id": "z4bfkjkfy5csqpyjgrj8ctqz4o",
          "date": "2026-01-01",
          "item": "Opening balance",
          "amount": 1200
        },
        {
          "id": "xzit1mrr1mgoiqo6ee5aon4c7f",
          "date": "2026-01-28",
          "item": "Salary",
          "amount": 3600
        },
        {
          "id": "zc97gcrezrrayob3mtz7c6miqa",
          "date": "2026-01-02",
          "item": "Rent",
          "amount": -1450
        },
        {
          "id": "kwmndi1coeyj44ui3fba8xm1ya",
          "date": "2026-01-10",
          "item": "Groceries",
          "amount": -410
        },
        {
          "id": "3agkc9teunqagz4t4x63z8mphm",
          "date": "2026-01-15",
          "item": "Energy",
          "amount": -142
        },
        {
          "id": "3k3n65mn4hi5p193ofrhrxk58d",
          "date": "2026-02-02",
          "item": "Rent",
          "amount": -1450
        },
        {
          "id": "8qu3wjyhxcy94ow8ecekqjrrt3",
          "date": "2026-02-27",
          "item": "Salary",
          "amount": 3600
        },
        {
          "id": "j6xmp5j9wkexyaesqa5uaiwqbb",
          "date": "2026-02-12",
          "item": "Transport",
          "amount": -165
        },
        {
          "id": "e5sjrefsnss7c8xgbjmcwtgeqy",
          "date": "2026-02-20",
          "item": "Eating out",
          "amount": -95
        },
        {
          "id": "6834q711q9jsjuo5785dcq14sr",
          "date": "2026-02-28",
          "item": "To savings",
          "amount": -500
        }
      ],
      "views": [
        {
          "id": "7wxsrxd9g5oa5smry9tmfahdzs",
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
          "id": "63occwsg8oxgutjn9s5jxyqfkf",
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
      "path": "fixtures/household-budget.table/tables/ledger",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "z4bfkjkfy5csqpyjgrj8ctqz4o",
            "xzit1mrr1mgoiqo6ee5aon4c7f",
            "zc97gcrezrrayob3mtz7c6miqa",
            "kwmndi1coeyj44ui3fba8xm1ya",
            "3agkc9teunqagz4t4x63z8mphm",
            "3k3n65mn4hi5p193ofrhrxk58d",
            "8qu3wjyhxcy94ow8ecekqjrrt3",
            "j6xmp5j9wkexyaesqa5uaiwqbb",
            "e5sjrefsnss7c8xgbjmcwtgeqy",
            "6834q711q9jsjuo5785dcq14sr"
          ]
        }
      ]
    }
  },
  "path": "fixtures/household-budget.table"
};
