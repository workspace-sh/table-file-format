// Generated from fixtures/shop.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const shopBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
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
            "id": "ek788rsnx5gzi",
            "name": "number",
            "type": "string",
            "title": "Order",
            "constraints": {
              "required": true,
              "unique": true
            }
          },
          {
            "id": "8kggyzjcrbp75",
            "name": "customer",
            "type": "string",
            "title": "Customer",
            "relation": {
              "table": "customers",
              "field": "id"
            }
          },
          {
            "id": "qs5wtma53wsox",
            "name": "ordered",
            "type": "date",
            "title": "Ordered"
          },
          {
            "id": "ct5d6ndk38c8d",
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
            "id": "nm9efu6zgd3zo",
            "name": "shipping",
            "type": "number",
            "title": "Shipping",
            "format": "currency:GBP"
          },
          {
            "id": "nqjnkkiyyier1",
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
            "id": "b8qqo6ndauzug",
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
            "id": "y9cxdk3dhxqur",
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
            "id": "q7es69q4j14e6",
            "name": "city",
            "type": "string",
            "title": "City",
            "description": "Looked up from the order's customer (D36).",
            "computed": {
              "expr": "(related \"customer\" \"city\")",
              "dialect": "table-expr-v1"
            }
          }
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "ob4xghd7r9hqqs3ake4us1nt63",
          "number": "#1001",
          "customer": "bj1ghy45ym894an5x1ku56gur5",
          "ordered": "2026-08-03",
          "status": "delivered",
          "shipping": 3.5
        },
        {
          "id": "tkxyjc9eye14wwhp1qu1ct5dhd",
          "number": "#1002",
          "customer": "zt6cy3mx5fb7ozkbdb5knwy5qr",
          "ordered": "2026-08-05",
          "status": "delivered",
          "shipping": 0
        },
        {
          "id": "a8k5z7ap4qsoy8d1d8gaj98ixf",
          "number": "#1003",
          "customer": "sqewfr5b4hunz4qe33ebcmy9s4",
          "ordered": "2026-08-11",
          "status": "delivered",
          "shipping": 3.5
        },
        {
          "id": "e4978orkencyqquqdychdambwp",
          "number": "#1004",
          "customer": "bj1ghy45ym894an5x1ku56gur5",
          "ordered": "2026-08-17",
          "status": "refunded",
          "shipping": 3.5
        },
        {
          "id": "s6q8azgi1ro6hcmhdgw5wysc83",
          "number": "#1005",
          "customer": "cwaamegmih8i4g7unp6d4amh3y",
          "ordered": "2026-08-24",
          "status": "delivered",
          "shipping": 3.5
        },
        {
          "id": "c3hydaasocm1mqdt9f4qahukpc",
          "number": "#1006",
          "customer": "b44yqmx5oun9kmb51dh8q4qqtb",
          "ordered": "2026-08-29",
          "status": "shipped",
          "shipping": 3.5
        },
        {
          "id": "uiiz5asdafqto7468giry8g45z",
          "number": "#1007",
          "customer": "zt6cy3mx5fb7ozkbdb5knwy5qr",
          "ordered": "2026-09-02",
          "status": "delivered",
          "shipping": 0
        },
        {
          "id": "o8ee5ux7cxjpwdmrnbeadp6tgz",
          "number": "#1008",
          "customer": "juhsk7aiywrpx1cexhe5ipgiuf",
          "ordered": "2026-09-06",
          "status": "shipped",
          "shipping": 4.5
        },
        {
          "id": "3gj7ys9pzwkxp7i3dm7bjjufz6",
          "number": "#1009",
          "customer": "u7f71dnitqr9fspst36zszspec",
          "ordered": "2026-09-10",
          "status": "paid",
          "shipping": 0
        },
        {
          "id": "am8adqxn1oubmfri713euckx7x",
          "number": "#1010",
          "customer": "bj1ghy45ym894an5x1ku56gur5",
          "ordered": "2026-09-14",
          "status": "paid",
          "shipping": 3.5
        },
        {
          "id": "kf3rpts54th5zw6q8mf64wuqqe",
          "number": "#1011",
          "customer": "igiw397mrupoxa6j6xjk54bzw4",
          "ordered": "2026-09-18",
          "status": "pending",
          "shipping": 3.5
        },
        {
          "id": "5tbaybjdk4tzbwkq9on45j6q54",
          "number": "#1012",
          "customer": "sqewfr5b4hunz4qe33ebcmy9s4",
          "ordered": "2026-09-20",
          "status": "paid",
          "shipping": 3.5
        },
        {
          "id": "g86jbr7d4znp78r4xc7zzns3he",
          "number": "#1013",
          "customer": "zt6cy3mx5fb7ozkbdb5knwy5qr",
          "ordered": "2026-09-23",
          "status": "pending",
          "shipping": 0
        },
        {
          "id": "rsa389qbeuffe1hzot7ixz69xj",
          "number": "#1014",
          "customer": "cwaamegmih8i4g7unp6d4amh3y",
          "ordered": "2026-09-25",
          "status": "pending",
          "shipping": 3.5
        }
      ],
      "views": [
        {
          "id": "hnmryzi51j6jz",
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
          "id": "j79j66pjaafew",
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
          "id": "m45au98xccumq",
          "name": "Calendar",
          "layout": "calendar",
          "calendar_field": "ordered"
        },
        {
          "id": "zhccfwcqrmbk1",
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
      "path": "fixtures/shop.table/tables/orders",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "ob4xghd7r9hqqs3ake4us1nt63",
            "tkxyjc9eye14wwhp1qu1ct5dhd",
            "a8k5z7ap4qsoy8d1d8gaj98ixf",
            "e4978orkencyqquqdychdambwp",
            "s6q8azgi1ro6hcmhdgw5wysc83",
            "c3hydaasocm1mqdt9f4qahukpc",
            "uiiz5asdafqto7468giry8g45z",
            "o8ee5ux7cxjpwdmrnbeadp6tgz",
            "3gj7ys9pzwkxp7i3dm7bjjufz6",
            "am8adqxn1oubmfri713euckx7x",
            "kf3rpts54th5zw6q8mf64wuqqe",
            "5tbaybjdk4tzbwkq9on45j6q54",
            "g86jbr7d4znp78r4xc7zzns3he",
            "rsa389qbeuffe1hzot7ixz69xj"
          ]
        }
      ]
    },
    "customers": {
      "schema": {
        "fields": [
          {
            "id": "rghwqogkxjjs8",
            "name": "name",
            "type": "string",
            "title": "Customer",
            "constraints": {
              "required": true
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
            "id": "q7es69q4j14e6",
            "name": "city",
            "type": "string",
            "title": "City"
          },
          {
            "id": "xmeqq5g45mirc",
            "name": "since",
            "type": "date",
            "title": "Customer since"
          },
          {
            "id": "8oeaytgn4b3t8",
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
            "id": "puzgc95iwatw5",
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
          "id": "bj1ghy45ym894an5x1ku56gur5",
          "name": "Ada Okafor",
          "email": "ada@example.com",
          "city": "Manchester",
          "since": "2025-03-14"
        },
        {
          "id": "sqewfr5b4hunz4qe33ebcmy9s4",
          "name": "Ben Hartley",
          "email": "ben@example.com",
          "city": "Leeds",
          "since": "2025-06-02"
        },
        {
          "id": "zt6cy3mx5fb7ozkbdb5knwy5qr",
          "name": "Chloé Martin",
          "email": "chloe@example.com",
          "city": "London",
          "since": "2024-11-20"
        },
        {
          "id": "cwaamegmih8i4g7unp6d4amh3y",
          "name": "Dev Patel",
          "email": "dev@example.com",
          "city": "Birmingham",
          "since": "2026-01-09"
        },
        {
          "id": "b44yqmx5oun9kmb51dh8q4qqtb",
          "name": "Ewa Nowak",
          "email": "ewa@example.com",
          "city": "Bristol",
          "since": "2025-09-30"
        },
        {
          "id": "juhsk7aiywrpx1cexhe5ipgiuf",
          "name": "Finn Walsh",
          "email": "finn@example.com",
          "city": "Glasgow",
          "since": "2026-04-18"
        },
        {
          "id": "u7f71dnitqr9fspst36zszspec",
          "name": "Grace Lin",
          "email": "grace@example.com",
          "city": "London",
          "since": "2026-07-01"
        },
        {
          "id": "igiw397mrupoxa6j6xjk54bzw4",
          "name": "Hugo Silva",
          "email": "hugo@example.com",
          "city": "Cardiff",
          "since": "2026-08-22"
        }
      ],
      "views": [
        {
          "id": "hnmryzi51j6jz",
          "name": "All customers",
          "layout": "table",
          "totals": {
            "name": "count",
            "order_count": "sum",
            "lifetime_value": "sum"
          }
        },
        {
          "id": "apzifyeyrctux",
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
          "id": "3quwu3444q51s",
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
      "path": "fixtures/shop.table/tables/customers",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "bj1ghy45ym894an5x1ku56gur5",
            "sqewfr5b4hunz4qe33ebcmy9s4",
            "zt6cy3mx5fb7ozkbdb5knwy5qr",
            "cwaamegmih8i4g7unp6d4amh3y",
            "b44yqmx5oun9kmb51dh8q4qqtb",
            "juhsk7aiywrpx1cexhe5ipgiuf",
            "u7f71dnitqr9fspst36zszspec",
            "igiw397mrupoxa6j6xjk54bzw4"
          ]
        }
      ]
    },
    "products": {
      "schema": {
        "fields": [
          {
            "id": "rghwqogkxjjs8",
            "name": "name",
            "type": "string",
            "title": "Product",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "dut55job7adfd",
            "name": "sku",
            "type": "string",
            "title": "SKU",
            "constraints": {
              "unique": true,
              "pattern": "^[A-Z]{3}-[0-9]{3}$"
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
            "id": "xiyakxmw7ii5m",
            "name": "price",
            "type": "number",
            "title": "Price",
            "format": "currency:GBP",
            "constraints": {
              "minimum": 0
            }
          },
          {
            "id": "mwducew9zqd66",
            "name": "stock",
            "type": "integer",
            "title": "In stock",
            "constraints": {
              "minimum": 0
            }
          },
          {
            "id": "g8iukiwnptueh",
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
            "id": "pet45mnhqbk7n",
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
          "id": "ckdfth9ap3e5k5zyxwcx4zy5zy",
          "name": "House blend, 250 g",
          "sku": "COF-001",
          "category": "coffee",
          "price": 8.5,
          "stock": 40
        },
        {
          "id": "99f9rh1upykhpm8hqgocy8dcdt",
          "name": "Ethiopia Yirgacheffe, 250 g",
          "sku": "COF-002",
          "category": "coffee",
          "price": 11,
          "stock": 22
        },
        {
          "id": "8yni337fhkej6p95fhg4g9dni3",
          "name": "Swiss water decaf, 250 g",
          "sku": "COF-003",
          "category": "coffee",
          "price": 9,
          "stock": 15
        },
        {
          "id": "qcupmwhx8z417nisu3iz1axg9r",
          "name": "Sencha green tea, 100 g",
          "sku": "TEA-001",
          "category": "tea",
          "price": 6.5,
          "stock": 30
        },
        {
          "id": "y37pw16qtpzop8uazkmxabk1wj",
          "name": "Earl Grey, 100 g",
          "sku": "TEA-002",
          "category": "tea",
          "price": 5.5,
          "stock": 28
        },
        {
          "id": "jf4a9dhmjmhatb496bbguo485w",
          "name": "Pour-over dripper",
          "sku": "EQP-001",
          "category": "equipment",
          "price": 24,
          "stock": 8
        },
        {
          "id": "ufs5khxeq6srikbgnenm1gk11t",
          "name": "Hand grinder",
          "sku": "EQP-002",
          "category": "equipment",
          "price": 65,
          "stock": 5
        },
        {
          "id": "pms7u6snpaizxau7e9pgonwgp3",
          "name": "Gooseneck kettle",
          "sku": "EQP-003",
          "category": "equipment",
          "price": 49,
          "stock": 6
        },
        {
          "id": "9n6pm887izr8okqbdkawyqud5s",
          "name": "Enamel mug",
          "sku": "MER-001",
          "category": "merch",
          "price": 12,
          "stock": 50
        },
        {
          "id": "n16m34d35agej3rymwcjdqhbho",
          "name": "Canvas tote",
          "sku": "MER-002",
          "category": "merch",
          "price": 9.5,
          "stock": 35
        }
      ],
      "views": [
        {
          "id": "c7by3xraxgzc6",
          "name": "Catalogue",
          "layout": "table",
          "totals": {
            "name": "count",
            "units_sold": "sum",
            "revenue": "sum"
          }
        },
        {
          "id": "ww8mpspmg15jb",
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
          "id": "rzq9gx8aeh8ta",
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
      "path": "fixtures/shop.table/tables/products",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "ckdfth9ap3e5k5zyxwcx4zy5zy",
            "99f9rh1upykhpm8hqgocy8dcdt",
            "8yni337fhkej6p95fhg4g9dni3",
            "qcupmwhx8z417nisu3iz1axg9r",
            "y37pw16qtpzop8uazkmxabk1wj",
            "jf4a9dhmjmhatb496bbguo485w",
            "ufs5khxeq6srikbgnenm1gk11t",
            "pms7u6snpaizxau7e9pgonwgp3",
            "9n6pm887izr8okqbdkawyqud5s",
            "n16m34d35agej3rymwcjdqhbho"
          ]
        }
      ]
    },
    "lines": {
      "schema": {
        "fields": [
          {
            "id": "jubpyw8ycy4ek",
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
            "id": "e5ftmj6ihzran",
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
            "id": "buzu1few1xqz4",
            "name": "quantity",
            "type": "integer",
            "title": "Quantity",
            "constraints": {
              "minimum": 1
            }
          },
          {
            "id": "8bm6engmac1ih",
            "name": "unit_price",
            "type": "number",
            "title": "Unit price",
            "format": "currency:GBP",
            "description": "Looked up from the product (D36).",
            "computed": {
              "expr": "(related \"product\" \"price\")",
              "dialect": "table-expr-v1"
            }
          },
          {
            "id": "8nj5bdwnbdxp4",
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
          "id": "de5mgeh4f39jwgr3qpi4uaqqoq",
          "order": "ob4xghd7r9hqqs3ake4us1nt63",
          "product": "ckdfth9ap3e5k5zyxwcx4zy5zy",
          "quantity": 2
        },
        {
          "id": "toxne1d316tpys51uo5h98es95",
          "order": "ob4xghd7r9hqqs3ake4us1nt63",
          "product": "9n6pm887izr8okqbdkawyqud5s",
          "quantity": 1
        },
        {
          "id": "93ekm9whzqf76xw5hxgu6c86dz",
          "order": "tkxyjc9eye14wwhp1qu1ct5dhd",
          "product": "99f9rh1upykhpm8hqgocy8dcdt",
          "quantity": 1
        },
        {
          "id": "7ngqn78jj1ibgctieo4eyifqad",
          "order": "tkxyjc9eye14wwhp1qu1ct5dhd",
          "product": "jf4a9dhmjmhatb496bbguo485w",
          "quantity": 1
        },
        {
          "id": "6py7dcyy844x7d94rj7ucn611f",
          "order": "tkxyjc9eye14wwhp1qu1ct5dhd",
          "product": "ufs5khxeq6srikbgnenm1gk11t",
          "quantity": 1
        },
        {
          "id": "efd6zra6swmrge1hubwfkmbi3x",
          "order": "a8k5z7ap4qsoy8d1d8gaj98ixf",
          "product": "qcupmwhx8z417nisu3iz1axg9r",
          "quantity": 2
        },
        {
          "id": "5fyi9typx1j3a341194t1kzwtc",
          "order": "a8k5z7ap4qsoy8d1d8gaj98ixf",
          "product": "y37pw16qtpzop8uazkmxabk1wj",
          "quantity": 1
        },
        {
          "id": "suxypc3ifyquw4wg93xc9x6yao",
          "order": "e4978orkencyqquqdychdambwp",
          "product": "pms7u6snpaizxau7e9pgonwgp3",
          "quantity": 1
        },
        {
          "id": "7t547qrugwq4o7fiir4ndyiokt",
          "order": "s6q8azgi1ro6hcmhdgw5wysc83",
          "product": "ckdfth9ap3e5k5zyxwcx4zy5zy",
          "quantity": 3
        },
        {
          "id": "gdogk96o5uiirb98uach5bbg1g",
          "order": "c3hydaasocm1mqdt9f4qahukpc",
          "product": "8yni337fhkej6p95fhg4g9dni3",
          "quantity": 1
        },
        {
          "id": "saurh16yxct6cwzaz814myk37e",
          "order": "c3hydaasocm1mqdt9f4qahukpc",
          "product": "n16m34d35agej3rymwcjdqhbho",
          "quantity": 2
        },
        {
          "id": "p8mcz7g8duuhks3qxhk7a7ufxj",
          "order": "uiiz5asdafqto7468giry8g45z",
          "product": "99f9rh1upykhpm8hqgocy8dcdt",
          "quantity": 2
        },
        {
          "id": "tsmhgs4mmthqb493ss5yfr5o45",
          "order": "uiiz5asdafqto7468giry8g45z",
          "product": "9n6pm887izr8okqbdkawyqud5s",
          "quantity": 2
        },
        {
          "id": "3hayxcuyz5dj3h71cqo4nwzgz8",
          "order": "o8ee5ux7cxjpwdmrnbeadp6tgz",
          "product": "ufs5khxeq6srikbgnenm1gk11t",
          "quantity": 1
        },
        {
          "id": "uwwx9tmzbt5fuqufxchm3g34jc",
          "order": "o8ee5ux7cxjpwdmrnbeadp6tgz",
          "product": "ckdfth9ap3e5k5zyxwcx4zy5zy",
          "quantity": 1
        },
        {
          "id": "w6r93shq4czys5jipo7egk6hyg",
          "order": "3gj7ys9pzwkxp7i3dm7bjjufz6",
          "product": "pms7u6snpaizxau7e9pgonwgp3",
          "quantity": 1
        },
        {
          "id": "eorn6hbxwd3mbmemwpfcu5jzqq",
          "order": "3gj7ys9pzwkxp7i3dm7bjjufz6",
          "product": "jf4a9dhmjmhatb496bbguo485w",
          "quantity": 1
        },
        {
          "id": "mgkekcbabitryzq33o7tea373c",
          "order": "3gj7ys9pzwkxp7i3dm7bjjufz6",
          "product": "99f9rh1upykhpm8hqgocy8dcdt",
          "quantity": 1
        },
        {
          "id": "jnnguooh1eah79u8gd54jw64yi",
          "order": "am8adqxn1oubmfri713euckx7x",
          "product": "ckdfth9ap3e5k5zyxwcx4zy5zy",
          "quantity": 2
        },
        {
          "id": "g766d6zpqq79nd8dkoj58kkejh",
          "order": "am8adqxn1oubmfri713euckx7x",
          "product": "y37pw16qtpzop8uazkmxabk1wj",
          "quantity": 2
        },
        {
          "id": "raezs6ytz9u3uzjzcaxis483fu",
          "order": "kf3rpts54th5zw6q8mf64wuqqe",
          "product": "qcupmwhx8z417nisu3iz1axg9r",
          "quantity": 1
        },
        {
          "id": "8h9b9zta7c7ef5isad6jqpj3xn",
          "order": "kf3rpts54th5zw6q8mf64wuqqe",
          "product": "n16m34d35agej3rymwcjdqhbho",
          "quantity": 1
        },
        {
          "id": "bxcx9dmxk689hzrcyh3g4jdjbr",
          "order": "5tbaybjdk4tzbwkq9on45j6q54",
          "product": "8yni337fhkej6p95fhg4g9dni3",
          "quantity": 2
        },
        {
          "id": "x116ohdh5q9uir6kmoqoq37mg8",
          "order": "g86jbr7d4znp78r4xc7zzns3he",
          "product": "9n6pm887izr8okqbdkawyqud5s",
          "quantity": 4
        },
        {
          "id": "j91dirf6pfzkm8gzm1u8mfrkqc",
          "order": "g86jbr7d4znp78r4xc7zzns3he",
          "product": "ckdfth9ap3e5k5zyxwcx4zy5zy",
          "quantity": 2
        },
        {
          "id": "i59pury4wysddwwe8r13pdgje9",
          "order": "rsa389qbeuffe1hzot7ixz69xj",
          "product": "ufs5khxeq6srikbgnenm1gk11t",
          "quantity": 1
        },
        {
          "id": "e8xre1pt5euitfkdg9ew1ymrwc",
          "order": "rsa389qbeuffe1hzot7ixz69xj",
          "product": "99f9rh1upykhpm8hqgocy8dcdt",
          "quantity": 1
        },
        {
          "id": "garnzpybp1mjqe7jd5we8sw7ia",
          "order": "rsa389qbeuffe1hzot7ixz69xj",
          "product": "y37pw16qtpzop8uazkmxabk1wj",
          "quantity": 1
        }
      ],
      "views": [
        {
          "id": "hnmryzi51j6jz",
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
      "path": "fixtures/shop.table/tables/lines",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "de5mgeh4f39jwgr3qpi4uaqqoq",
            "toxne1d316tpys51uo5h98es95",
            "93ekm9whzqf76xw5hxgu6c86dz",
            "7ngqn78jj1ibgctieo4eyifqad",
            "6py7dcyy844x7d94rj7ucn611f",
            "efd6zra6swmrge1hubwfkmbi3x",
            "5fyi9typx1j3a341194t1kzwtc",
            "suxypc3ifyquw4wg93xc9x6yao",
            "7t547qrugwq4o7fiir4ndyiokt",
            "gdogk96o5uiirb98uach5bbg1g",
            "saurh16yxct6cwzaz814myk37e",
            "p8mcz7g8duuhks3qxhk7a7ufxj",
            "tsmhgs4mmthqb493ss5yfr5o45",
            "3hayxcuyz5dj3h71cqo4nwzgz8",
            "uwwx9tmzbt5fuqufxchm3g34jc",
            "w6r93shq4czys5jipo7egk6hyg",
            "eorn6hbxwd3mbmemwpfcu5jzqq",
            "mgkekcbabitryzq33o7tea373c",
            "jnnguooh1eah79u8gd54jw64yi",
            "g766d6zpqq79nd8dkoj58kkejh",
            "raezs6ytz9u3uzjzcaxis483fu",
            "8h9b9zta7c7ef5isad6jqpj3xn",
            "bxcx9dmxk689hzrcyh3g4jdjbr",
            "x116ohdh5q9uir6kmoqoq37mg8",
            "j91dirf6pfzkm8gzm1u8mfrkqc",
            "i59pury4wysddwwe8r13pdgje9",
            "e8xre1pt5euitfkdg9ew1ymrwc",
            "garnzpybp1mjqe7jd5we8sw7ia"
          ]
        }
      ]
    }
  },
  "path": "fixtures/shop.table"
};
