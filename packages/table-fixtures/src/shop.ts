// Generated from fixtures/shop.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const shopBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Shop",
    "description": "A small coffee shop: customers, products, orders and the lines on each, linked together.",
    "tables": [
      "orders",
      "customers",
      "products",
      "lines"
    ],
    "created_at": "2026-09-26T00:00:00Z",
    "modified_at": "2026-09-26T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "tables": {
    "orders": {
      "schema": {
        "fields": [
          {
            "name": "number",
            "type": "string",
            "title": "Order",
            "constraints": {
              "required": true,
              "unique": true
            }
          },
          {
            "name": "customer",
            "type": "string",
            "title": "Customer",
            "relation": {
              "table": "customers",
              "field": "id"
            }
          },
          {
            "name": "ordered",
            "type": "date",
            "title": "Ordered"
          },
          {
            "name": "status",
            "type": "string",
            "title": "Status",
            "constraints": {
              "enum": [
                {
                  "value": "pending",
                  "label": "Pending",
                  "color": "gray"
                },
                {
                  "value": "paid",
                  "label": "Paid",
                  "color": "blue"
                },
                {
                  "value": "shipped",
                  "label": "Shipped",
                  "color": "orange"
                },
                {
                  "value": "delivered",
                  "label": "Delivered",
                  "color": "green"
                },
                {
                  "value": "refunded",
                  "label": "Refunded",
                  "color": "red"
                }
              ]
            }
          },
          {
            "name": "shipping",
            "type": "number",
            "title": "Shipping",
            "format": "currency:GBP"
          },
          {
            "name": "items",
            "type": "number",
            "title": "Items",
            "description": "How many things are on the order: the quantities on its lines.",
            "computed": {
              "expr": "(sum (linked \"lines\" \"order\" \"quantity\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "subtotal",
            "type": "number",
            "title": "Subtotal",
            "format": "currency:GBP",
            "description": "The sum of the order's lines (D36).",
            "computed": {
              "expr": "(sum (linked \"lines\" \"order\" \"line_total\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "total",
            "type": "number",
            "title": "Total",
            "format": "currency:GBP",
            "description": "Subtotal plus shipping.",
            "computed": {
              "expr": "(+ subtotal shipping)",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "city",
            "type": "string",
            "title": "City",
            "description": "Looked up from the order's customer (D36).",
            "computed": {
              "expr": "(lookup \"customer\" \"city\")",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "or-1001",
          "number": "#1001",
          "customer": "cu-ada",
          "ordered": "2026-08-03",
          "status": "delivered",
          "shipping": 3.5
        },
        {
          "id": "or-1002",
          "number": "#1002",
          "customer": "cu-chloe",
          "ordered": "2026-08-05",
          "status": "delivered",
          "shipping": 0
        },
        {
          "id": "or-1003",
          "number": "#1003",
          "customer": "cu-ben",
          "ordered": "2026-08-11",
          "status": "delivered",
          "shipping": 3.5
        },
        {
          "id": "or-1004",
          "number": "#1004",
          "customer": "cu-ada",
          "ordered": "2026-08-17",
          "status": "refunded",
          "shipping": 3.5
        },
        {
          "id": "or-1005",
          "number": "#1005",
          "customer": "cu-dev",
          "ordered": "2026-08-24",
          "status": "delivered",
          "shipping": 3.5
        },
        {
          "id": "or-1006",
          "number": "#1006",
          "customer": "cu-ewa",
          "ordered": "2026-08-29",
          "status": "shipped",
          "shipping": 3.5
        },
        {
          "id": "or-1007",
          "number": "#1007",
          "customer": "cu-chloe",
          "ordered": "2026-09-02",
          "status": "delivered",
          "shipping": 0
        },
        {
          "id": "or-1008",
          "number": "#1008",
          "customer": "cu-finn",
          "ordered": "2026-09-06",
          "status": "shipped",
          "shipping": 4.5
        },
        {
          "id": "or-1009",
          "number": "#1009",
          "customer": "cu-grace",
          "ordered": "2026-09-10",
          "status": "paid",
          "shipping": 0
        },
        {
          "id": "or-1010",
          "number": "#1010",
          "customer": "cu-ada",
          "ordered": "2026-09-14",
          "status": "paid",
          "shipping": 3.5
        },
        {
          "id": "or-1011",
          "number": "#1011",
          "customer": "cu-hugo",
          "ordered": "2026-09-18",
          "status": "pending",
          "shipping": 3.5
        },
        {
          "id": "or-1012",
          "number": "#1012",
          "customer": "cu-ben",
          "ordered": "2026-09-20",
          "status": "paid",
          "shipping": 3.5
        },
        {
          "id": "or-1013",
          "number": "#1013",
          "customer": "cu-chloe",
          "ordered": "2026-09-23",
          "status": "pending",
          "shipping": 0
        },
        {
          "id": "or-1014",
          "number": "#1014",
          "customer": "cu-dev",
          "ordered": "2026-09-25",
          "status": "pending",
          "shipping": 3.5
        }
      ],
      "views": [
        {
          "id": "all",
          "name": "All orders",
          "layout": "table",
          "sort": [
            {
              "field": "ordered",
              "direction": "desc"
            }
          ],
          "totals": {
            "number": "count",
            "items": "sum",
            "subtotal": "sum",
            "total": "sum"
          },
          "fields": [
            "number",
            "customer",
            "status",
            "items",
            "subtotal",
            "shipping",
            "total",
            "ordered",
            "city"
          ]
        },
        {
          "id": "fulfilment",
          "name": "Fulfilment",
          "layout": "board",
          "board_field": "status",
          "fields": [
            "number",
            "customer",
            "total",
            "ordered"
          ]
        },
        {
          "id": "calendar",
          "name": "Calendar",
          "layout": "calendar",
          "calendar_field": "ordered"
        },
        {
          "id": "to-ship",
          "name": "To ship",
          "layout": "table",
          "filter": [
            {
              "field": "status",
              "operator": "in",
              "value": [
                "paid",
                "pending"
              ]
            }
          ],
          "sort": [
            {
              "field": "ordered",
              "direction": "asc"
            }
          ],
          "fields": [
            "number",
            "customer",
            "city",
            "items",
            "total"
          ]
        }
      ],
      "meta": {
        "title": "Orders",
        "description": "Each order a customer placed."
      },
      "path": "fixtures/shop.table/tables/orders"
    },
    "customers": {
      "schema": {
        "fields": [
          {
            "name": "name",
            "type": "string",
            "title": "Customer",
            "constraints": {
              "required": true
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
            "name": "city",
            "type": "string",
            "title": "City"
          },
          {
            "name": "since",
            "type": "date",
            "title": "Customer since"
          },
          {
            "name": "order_count",
            "type": "number",
            "title": "Orders",
            "description": "How many orders link to this customer.",
            "computed": {
              "expr": "(count (linked \"orders\" \"customer\" \"number\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "lifetime_value",
            "type": "number",
            "title": "Lifetime value",
            "format": "currency:GBP",
            "description": "The total of this customer's orders. Each order's total is itself the sum of its lines, so this reads two tables deep (D36).",
            "computed": {
              "expr": "(sum (linked \"orders\" \"customer\" \"total\"))",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "cu-ada",
          "name": "Ada Okafor",
          "email": "ada@example.com",
          "city": "Manchester",
          "since": "2025-03-14"
        },
        {
          "id": "cu-ben",
          "name": "Ben Hartley",
          "email": "ben@example.com",
          "city": "Leeds",
          "since": "2025-06-02"
        },
        {
          "id": "cu-chloe",
          "name": "Chloé Martin",
          "email": "chloe@example.com",
          "city": "London",
          "since": "2024-11-20"
        },
        {
          "id": "cu-dev",
          "name": "Dev Patel",
          "email": "dev@example.com",
          "city": "Birmingham",
          "since": "2026-01-09"
        },
        {
          "id": "cu-ewa",
          "name": "Ewa Nowak",
          "email": "ewa@example.com",
          "city": "Bristol",
          "since": "2025-09-30"
        },
        {
          "id": "cu-finn",
          "name": "Finn Walsh",
          "email": "finn@example.com",
          "city": "Glasgow",
          "since": "2026-04-18"
        },
        {
          "id": "cu-grace",
          "name": "Grace Lin",
          "email": "grace@example.com",
          "city": "London",
          "since": "2026-07-01"
        },
        {
          "id": "cu-hugo",
          "name": "Hugo Silva",
          "email": "hugo@example.com",
          "city": "Cardiff",
          "since": "2026-08-22"
        }
      ],
      "views": [
        {
          "id": "all",
          "name": "All customers",
          "layout": "table",
          "totals": {
            "name": "count",
            "order_count": "sum",
            "lifetime_value": "sum"
          }
        },
        {
          "id": "top",
          "name": "Top customers",
          "layout": "table",
          "sort": [
            {
              "field": "lifetime_value",
              "direction": "desc"
            }
          ],
          "fields": [
            "name",
            "city",
            "order_count",
            "lifetime_value"
          ]
        },
        {
          "id": "by-city",
          "name": "By city",
          "layout": "table",
          "group": {
            "field": "city"
          },
          "fields": [
            "name",
            "email",
            "lifetime_value"
          ]
        }
      ],
      "meta": {
        "title": "Customers",
        "description": "People who order from the shop."
      },
      "path": "fixtures/shop.table/tables/customers"
    },
    "products": {
      "schema": {
        "fields": [
          {
            "name": "name",
            "type": "string",
            "title": "Product",
            "constraints": {
              "required": true
            }
          },
          {
            "name": "sku",
            "type": "string",
            "title": "SKU",
            "constraints": {
              "unique": true,
              "pattern": "^[A-Z]{3}-[0-9]{3}$"
            }
          },
          {
            "name": "category",
            "type": "string",
            "title": "Category",
            "constraints": {
              "enum": [
                {
                  "value": "coffee",
                  "label": "Coffee",
                  "color": "orange"
                },
                {
                  "value": "tea",
                  "label": "Tea",
                  "color": "green"
                },
                {
                  "value": "equipment",
                  "label": "Equipment",
                  "color": "gray"
                },
                {
                  "value": "merch",
                  "label": "Merch",
                  "color": "purple"
                }
              ]
            }
          },
          {
            "name": "price",
            "type": "number",
            "title": "Price",
            "format": "currency:GBP",
            "constraints": {
              "minimum": 0
            }
          },
          {
            "name": "stock",
            "type": "integer",
            "title": "In stock",
            "constraints": {
              "minimum": 0
            }
          },
          {
            "name": "units_sold",
            "type": "number",
            "title": "Units sold",
            "description": "The quantity on every order line for this product.",
            "computed": {
              "expr": "(sum (linked \"lines\" \"product\" \"quantity\"))",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "revenue",
            "type": "number",
            "title": "Revenue",
            "format": "currency:GBP",
            "description": "The total of every order line for this product.",
            "computed": {
              "expr": "(sum (linked \"lines\" \"product\" \"line_total\"))",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "pr-house",
          "name": "House blend, 250 g",
          "sku": "COF-001",
          "category": "coffee",
          "price": 8.5,
          "stock": 40
        },
        {
          "id": "pr-ethiopia",
          "name": "Ethiopia Yirgacheffe, 250 g",
          "sku": "COF-002",
          "category": "coffee",
          "price": 11,
          "stock": 22
        },
        {
          "id": "pr-decaf",
          "name": "Swiss water decaf, 250 g",
          "sku": "COF-003",
          "category": "coffee",
          "price": 9,
          "stock": 15
        },
        {
          "id": "pr-sencha",
          "name": "Sencha green tea, 100 g",
          "sku": "TEA-001",
          "category": "tea",
          "price": 6.5,
          "stock": 30
        },
        {
          "id": "pr-earl",
          "name": "Earl Grey, 100 g",
          "sku": "TEA-002",
          "category": "tea",
          "price": 5.5,
          "stock": 28
        },
        {
          "id": "pr-v60",
          "name": "Pour-over dripper",
          "sku": "EQP-001",
          "category": "equipment",
          "price": 24,
          "stock": 8
        },
        {
          "id": "pr-grinder",
          "name": "Hand grinder",
          "sku": "EQP-002",
          "category": "equipment",
          "price": 65,
          "stock": 5
        },
        {
          "id": "pr-kettle",
          "name": "Gooseneck kettle",
          "sku": "EQP-003",
          "category": "equipment",
          "price": 49,
          "stock": 6
        },
        {
          "id": "pr-mug",
          "name": "Enamel mug",
          "sku": "MER-001",
          "category": "merch",
          "price": 12,
          "stock": 50
        },
        {
          "id": "pr-tote",
          "name": "Canvas tote",
          "sku": "MER-002",
          "category": "merch",
          "price": 9.5,
          "stock": 35
        }
      ],
      "views": [
        {
          "id": "catalogue",
          "name": "Catalogue",
          "layout": "table",
          "totals": {
            "name": "count",
            "units_sold": "sum",
            "revenue": "sum"
          }
        },
        {
          "id": "by-category",
          "name": "By category",
          "layout": "board",
          "board_field": "category",
          "fields": [
            "name",
            "price",
            "stock"
          ]
        },
        {
          "id": "best-sellers",
          "name": "Best sellers",
          "layout": "table",
          "sort": [
            {
              "field": "units_sold",
              "direction": "desc"
            }
          ],
          "fields": [
            "name",
            "category",
            "units_sold",
            "revenue"
          ]
        }
      ],
      "meta": {
        "title": "Products",
        "description": "What the shop sells."
      },
      "path": "fixtures/shop.table/tables/products"
    },
    "lines": {
      "schema": {
        "fields": [
          {
            "name": "order",
            "type": "string",
            "title": "Order",
            "relation": {
              "table": "orders",
              "field": "id"
            },
            "constraints": {
              "required": true
            }
          },
          {
            "name": "product",
            "type": "string",
            "title": "Product",
            "relation": {
              "table": "products",
              "field": "id"
            },
            "constraints": {
              "required": true
            }
          },
          {
            "name": "quantity",
            "type": "integer",
            "title": "Quantity",
            "constraints": {
              "minimum": 1
            }
          },
          {
            "name": "unit_price",
            "type": "number",
            "title": "Unit price",
            "format": "currency:GBP",
            "description": "Looked up from the product (D36).",
            "computed": {
              "expr": "(lookup \"product\" \"price\")",
              "dialect": "table-expr-v1"
            }
          },
          {
            "name": "line_total",
            "type": "number",
            "title": "Line total",
            "format": "currency:GBP",
            "description": "Quantity times unit price.",
            "computed": {
              "expr": "(* quantity unit_price)",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "li-01",
          "order": "or-1001",
          "product": "pr-house",
          "quantity": 2
        },
        {
          "id": "li-02",
          "order": "or-1001",
          "product": "pr-mug",
          "quantity": 1
        },
        {
          "id": "li-03",
          "order": "or-1002",
          "product": "pr-ethiopia",
          "quantity": 1
        },
        {
          "id": "li-04",
          "order": "or-1002",
          "product": "pr-v60",
          "quantity": 1
        },
        {
          "id": "li-05",
          "order": "or-1002",
          "product": "pr-grinder",
          "quantity": 1
        },
        {
          "id": "li-06",
          "order": "or-1003",
          "product": "pr-sencha",
          "quantity": 2
        },
        {
          "id": "li-07",
          "order": "or-1003",
          "product": "pr-earl",
          "quantity": 1
        },
        {
          "id": "li-08",
          "order": "or-1004",
          "product": "pr-kettle",
          "quantity": 1
        },
        {
          "id": "li-09",
          "order": "or-1005",
          "product": "pr-house",
          "quantity": 3
        },
        {
          "id": "li-10",
          "order": "or-1006",
          "product": "pr-decaf",
          "quantity": 1
        },
        {
          "id": "li-11",
          "order": "or-1006",
          "product": "pr-tote",
          "quantity": 2
        },
        {
          "id": "li-12",
          "order": "or-1007",
          "product": "pr-ethiopia",
          "quantity": 2
        },
        {
          "id": "li-13",
          "order": "or-1007",
          "product": "pr-mug",
          "quantity": 2
        },
        {
          "id": "li-14",
          "order": "or-1008",
          "product": "pr-grinder",
          "quantity": 1
        },
        {
          "id": "li-15",
          "order": "or-1008",
          "product": "pr-house",
          "quantity": 1
        },
        {
          "id": "li-16",
          "order": "or-1009",
          "product": "pr-kettle",
          "quantity": 1
        },
        {
          "id": "li-17",
          "order": "or-1009",
          "product": "pr-v60",
          "quantity": 1
        },
        {
          "id": "li-18",
          "order": "or-1009",
          "product": "pr-ethiopia",
          "quantity": 1
        },
        {
          "id": "li-19",
          "order": "or-1010",
          "product": "pr-house",
          "quantity": 2
        },
        {
          "id": "li-20",
          "order": "or-1010",
          "product": "pr-earl",
          "quantity": 2
        },
        {
          "id": "li-21",
          "order": "or-1011",
          "product": "pr-sencha",
          "quantity": 1
        },
        {
          "id": "li-22",
          "order": "or-1011",
          "product": "pr-tote",
          "quantity": 1
        },
        {
          "id": "li-23",
          "order": "or-1012",
          "product": "pr-decaf",
          "quantity": 2
        },
        {
          "id": "li-24",
          "order": "or-1013",
          "product": "pr-mug",
          "quantity": 4
        },
        {
          "id": "li-25",
          "order": "or-1013",
          "product": "pr-house",
          "quantity": 2
        },
        {
          "id": "li-26",
          "order": "or-1014",
          "product": "pr-grinder",
          "quantity": 1
        },
        {
          "id": "li-27",
          "order": "or-1014",
          "product": "pr-ethiopia",
          "quantity": 1
        },
        {
          "id": "li-28",
          "order": "or-1014",
          "product": "pr-earl",
          "quantity": 1
        }
      ],
      "views": [
        {
          "id": "all",
          "name": "All lines",
          "layout": "table",
          "totals": {
            "order": "count",
            "quantity": "sum",
            "line_total": "sum"
          }
        }
      ],
      "meta": {
        "title": "Order lines",
        "description": "What's on each order: a product and how many."
      },
      "path": "fixtures/shop.table/tables/lines"
    }
  },
  "path": "fixtures/shop.table"
};
