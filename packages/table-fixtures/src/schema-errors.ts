// Generated from fixtures/schema-errors.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const schemaErrorsBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
    "title": "Schema errors",
    "tables": [
      "problems",
      "people"
    ]
  },
  "tables": {
    "problems": {
      "schema": {
        "fields": [
          {
            "id": "3m9azxjdzdi4s",
            "name": "problem",
            "type": "string",
            "title": "Problem"
          },
          {
            "id": "3d3b46jejfqa5",
            "name": "rule",
            "type": "string",
            "title": "Rule",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "fsk5k76m6e4qj",
            "name": "amount",
            "type": "number",
            "constraints": {
              "minimum": 0,
              "maximum": 100
            }
          },
          {
            "id": "rr9k34mb5ctaa",
            "name": "rate",
            "type": "number",
            "constraints": {
              "exclusiveMinimum": 0,
              "exclusiveMaximum": 1
            }
          },
          {
            "id": "tyzhbkzf6oytp",
            "name": "whole",
            "type": "integer"
          },
          {
            "id": "pssn6y6kk7d88",
            "name": "month",
            "type": "yearmonth"
          },
          {
            "id": "965owefa7nerf",
            "name": "due",
            "type": "date",
            "constraints": {
              "minimum": "2026-01-01"
            }
          },
          {
            "id": "z6yyjjfte4wa5",
            "name": "status",
            "type": "string",
            "categories": [
              {
                "value": "planning",
                "color": "gray"
              },
              {
                "value": "active",
                "color": "green"
              },
              {
                "value": "done",
                "color": "blue"
              },
              {
                "value": "archived",
                "color": "brown"
              }
            ]
          },
          {
            "id": "jahph4k331fsp",
            "name": "tags",
            "type": "array",
            "categories": [
              "red",
              "green"
            ]
          },
          {
            "id": "1313j31doghnq",
            "name": "code",
            "type": "string",
            "constraints": {
              "minLength": 3,
              "maxLength": 6,
              "pattern": "^[A-Z]+$"
            }
          },
          {
            "id": "gqj7ykmdy56w4",
            "name": "email",
            "type": "string",
            "format": "email",
            "constraints": {
              "unique": true
            }
          },
          {
            "id": "9bm8qmxjp1uau",
            "name": "sku",
            "type": "string"
          },
          {
            "id": "ra8e6k5k43x4o",
            "name": "region",
            "type": "string"
          },
          {
            "id": "aa3bwh89tamha",
            "name": "person",
            "type": "string"
          },
          {
            "id": "49rhiytkwgwbu",
            "name": "week",
            "type": "integer"
          },
          {
            "id": "ksoqeymbe9b79",
            "name": "owner",
            "type": "string",
            "relation": {
              "table": "people",
              "field": "id"
            }
          },
          {
            "id": "95aqwb56ghkf1",
            "name": "file",
            "type": "string",
            "attachment": true
          },
          {
            "id": "e5fxe74twkzth",
            "name": "again",
            "type": "number",
            "description": "Has the same id as amount (section 9, rule 6)."
          }
        ],
        "primaryKey": [
          "sku",
          "region"
        ],
        "uniqueKeys": [
          [
            "person",
            "week"
          ]
        ]
      },
      "rows": [
        {
          "id": "mr13pbifm9m1n1szjt57hgfhmg",
          "problem": "No problem: a row as it should be, to compare with",
          "rule": "—",
          "amount": 50,
          "rate": 0.5,
          "whole": 3,
          "month": "2026-11",
          "due": "2026-11-23",
          "status": "active",
          "tags": [
            "red"
          ],
          "code": "ABC",
          "email": "a@example.com",
          "owner": "i3isneqd9jt7zsdc5pn6wqjpsk",
          "file": "receipt.txt",
          "sku": "P01",
          "region": "EU"
        },
        {
          "id": "nwepjoeykdcw1a6dbk74ueo36k",
          "problem": "Wrong type: text in a whole-number field",
          "rule": "9.2 type",
          "whole": "twelve",
          "sku": "P02",
          "region": "EU"
        },
        {
          "id": "dwg8w5zd51nsuk4tzprrh3n9df",
          "problem": "Wrong type: not a year and month",
          "rule": "9.2 type",
          "month": "November",
          "sku": "P03",
          "region": "EU"
        },
        {
          "id": "eicqwcatngkximgn5qrtcfn9tn",
          "problem": "Wrong type: not a date",
          "rule": "9.2 type",
          "due": "next week",
          "sku": "P04",
          "region": "EU"
        },
        {
          "id": "tfke61qhgxbj1ftgh9y76qe6kp",
          "problem": "Required: this row has no rule",
          "sku": "P05",
          "region": "EU"
        },
        {
          "id": "rua68cd5qymg7j7dbhoxy35w1b",
          "problem": "Not a choice: status paused",
          "rule": "9.2 categories",
          "status": "paused",
          "sku": "P06",
          "region": "EU"
        },
        {
          "id": "u4skc11c9b67x1azgxymqq6jiz",
          "problem": "Not a choice: a tag that isn't one",
          "rule": "9.2 categories",
          "tags": [
            "red",
            "blue"
          ],
          "sku": "P07",
          "region": "EU"
        },
        {
          "id": "akbsdyzpqq8c888fq7sbpx7umz",
          "problem": "Below the minimum: amount under 0",
          "rule": "9.2 minimum",
          "amount": -5,
          "sku": "P08",
          "region": "EU"
        },
        {
          "id": "fphaf8i6x5qbi9pkd47yy5g34p",
          "problem": "Above the maximum: amount over 100",
          "rule": "9.2 maximum",
          "amount": 150,
          "sku": "P09",
          "region": "EU"
        },
        {
          "id": "er3x3cxyoti4ay9ej1mmmy55eh",
          "problem": "Not above the exclusive minimum: rate 0",
          "rule": "9.2 exclusiveMinimum",
          "rate": 0,
          "sku": "P10",
          "region": "EU"
        },
        {
          "id": "ukw3jjqsqouat8aqh9rcfw5xbu",
          "problem": "Not below the exclusive maximum: rate 1",
          "rule": "9.2 exclusiveMaximum",
          "rate": 1,
          "sku": "P11",
          "region": "EU"
        },
        {
          "id": "8hg5858aio5np6368yi7n5ugsx",
          "problem": "Before the minimum date: due in 2025",
          "rule": "9.2 minimum",
          "due": "2025-12-31",
          "sku": "P12",
          "region": "EU"
        },
        {
          "id": "dqbw7k47xhy93ebw6p5wmpgzft",
          "problem": "Too short: code under 3 letters",
          "rule": "9.2 minLength",
          "code": "AB",
          "sku": "P13",
          "region": "EU"
        },
        {
          "id": "tnqie9gonwq93w6im7aa6twkx3",
          "problem": "Too long: code over 6 letters",
          "rule": "9.2 maxLength",
          "code": "ABCDEFGH",
          "sku": "P14",
          "region": "EU"
        },
        {
          "id": "5ejjk68kwir4ce1qx9i5rfad4e",
          "problem": "Doesn't match the pattern: code in lower case",
          "rule": "9.2 pattern",
          "code": "abc",
          "sku": "P15",
          "region": "EU"
        },
        {
          "id": "5398173xfouk5q7qsffpaouxb9",
          "problem": "Not unique: email (first)",
          "rule": "9.2 unique",
          "email": "same@example.com",
          "sku": "P16",
          "region": "EU"
        },
        {
          "id": "7xydpx4t5hu38khyoxbke55ceh",
          "problem": "Not unique: email (second)",
          "rule": "9.2 unique",
          "email": "same@example.com",
          "sku": "P17",
          "region": "EU"
        },
        {
          "id": "j1msych7q8mpdgfc49n9wi736n",
          "problem": "Primary key: sku and region (first)",
          "rule": "9.3 primaryKey",
          "sku": "DUP",
          "region": "EU"
        },
        {
          "id": "f7tnt6re9oa4ajs3jnsos78783",
          "problem": "Primary key: sku and region (second)",
          "rule": "9.3 primaryKey",
          "sku": "DUP",
          "region": "EU"
        },
        {
          "id": "d5na8j7cqtsf1td7diiwbnbct5",
          "problem": "Unique key: person and week (first)",
          "rule": "9.3 uniqueKeys",
          "person": "Sam",
          "week": 47,
          "sku": "P20",
          "region": "EU"
        },
        {
          "id": "rbnbh5io95csqs5oxzkgo6paej",
          "problem": "Unique key: person and week (second)",
          "rule": "9.3 uniqueKeys",
          "person": "Sam",
          "week": 47,
          "sku": "P21",
          "region": "EU"
        },
        {
          "id": "zdbhfmohkmq7ryg48bhb9af336",
          "problem": "Orphaned page: bodies/ has a page for row u7zjkkzky4qtg9r7cfq36rfxb8, which isn't here",
          "rule": "9.4 bodies",
          "sku": "P22",
          "region": "EU"
        },
        {
          "id": "x6rq9ojroskd3z8fnitc1mqs8z",
          "problem": "A formula for a field the table hasn't (in cells/)",
          "rule": "9.5 cells",
          "sku": "P23",
          "region": "EU"
        },
        {
          "id": "7ipwcp5gfiuwn41dhggw8cbn3y",
          "problem": "A formula for a row the table hasn't (in cells/)",
          "rule": "9.5 cells",
          "sku": "P24",
          "region": "EU"
        },
        {
          "id": "rjm6aweeujb7co18uk5ad6rxj1",
          "problem": "Repeated field id: amount and again (in schema.json)",
          "rule": "9.6 field id",
          "sku": "P25",
          "region": "EU"
        },
        {
          "id": "grasg5dujbwhg94oh9b1qqontz",
          "problem": "Dangling link: owner names no row in people",
          "rule": "warning: relation",
          "owner": "dwideyddt9ed1c3m851csh5ams",
          "sku": "P26",
          "region": "EU"
        },
        {
          "id": "ni19g1ddbui9ir1d6cxwsfiou9",
          "problem": "Unused choice: no row's status is archived",
          "rule": "warning: categories",
          "sku": "P27",
          "region": "EU"
        },
        {
          "id": "eqg8jp3wwg6cjnkd3wt67hgjpy",
          "problem": "Orphaned attachment: attachments/unused.txt, no row holds it",
          "rule": "warning: attachment",
          "sku": "P28",
          "region": "EU"
        },
        {
          "id": "919iy85ge57rofosr4opp6toqi",
          "problem": "A cell's formula twice (in cells/): the first is used",
          "rule": "reader: cells",
          "sku": "P29",
          "region": "EU"
        },
        {
          "id": "fz4pi99yswuqf5nugoocduxe1j",
          "problem": "A value typed over a cell's formula: the value is used",
          "rule": "reader: cells",
          "amount": 7,
          "sku": "P30",
          "region": "EU"
        },
        {
          "id": "h3p8r8ayn7zp45ngn6zuwq697i",
          "problem": "A line of cells/ that isn't a formula",
          "rule": "reader: cells",
          "sku": "P31",
          "region": "EU"
        },
        {
          "id": "nags9dpp6713wc4mbcfesoijy5",
          "problem": "The people table's meta.json isn't JSON: it opens with defaults",
          "rule": "reader: meta.json",
          "sku": "P32",
          "region": "EU"
        },
        {
          "id": "r8udijg7mqh4upuuc8ypzwqr4b",
          "problem": "tables/notes/ isn't a table: it has no schema.json or rows/",
          "rule": "reader: bundle",
          "sku": "P33",
          "region": "EU"
        },
        {
          "id": "8fejncn45qtfpu7as76ma9qw71",
          "problem": "A line repeated exactly: the copy is left out",
          "rule": "reader: repeated id",
          "sku": "P34",
          "region": "EU"
        },
        {
          "id": "7bi8o44wduxm9nhyz8epfe4won",
          "problem": "Merge conflict: our side",
          "rule": "reader: conflict",
          "sku": "P35",
          "region": "EU"
        }
      ],
      "views": [
        {
          "id": "huhru65jt4uqb",
          "name": "Every problem",
          "layout": "table",
          "fields": [
            "problem",
            "rule",
            "amount",
            "rate",
            "whole",
            "month",
            "due",
            "status",
            "tags",
            "code",
            "email",
            "sku",
            "region",
            "person",
            "week",
            "owner",
            "file",
            "again"
          ],
          "columnWidths": {
            "problem": 360,
            "rule": 170
          }
        }
      ],
      "meta": {
        "title": "Every problem"
      },
      "path": "fixtures/schema-errors.table/tables/problems",
      "cells": [
        {
          "id": "x6rq9ojroskd3z8fnitc1mqs8z",
          "field": "nope",
          "expr": "(+ 1 1)"
        },
        {
          "id": "w4o9qszq5h79b7zuoit7knpjji",
          "field": "amount",
          "expr": "(+ 1 1)"
        },
        {
          "id": "919iy85ge57rofosr4opp6toqi",
          "field": "amount",
          "expr": "(+ 1 1)"
        },
        {
          "id": "919iy85ge57rofosr4opp6toqi",
          "field": "amount",
          "expr": "(+ 2 2)"
        },
        {
          "id": "fz4pi99yswuqf5nugoocduxe1j",
          "field": "amount",
          "expr": "(* 2 2)"
        }
      ],
      "unreadCells": [
        "{\"id\": \"a line of cells/ cut short"
      ],
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "mr13pbifm9m1n1szjt57hgfhmg",
            "nwepjoeykdcw1a6dbk74ueo36k",
            "dwg8w5zd51nsuk4tzprrh3n9df",
            "eicqwcatngkximgn5qrtcfn9tn",
            "tfke61qhgxbj1ftgh9y76qe6kp",
            "rua68cd5qymg7j7dbhoxy35w1b",
            "u4skc11c9b67x1azgxymqq6jiz",
            "akbsdyzpqq8c888fq7sbpx7umz",
            "fphaf8i6x5qbi9pkd47yy5g34p",
            "er3x3cxyoti4ay9ej1mmmy55eh",
            "ukw3jjqsqouat8aqh9rcfw5xbu",
            "8hg5858aio5np6368yi7n5ugsx",
            "dqbw7k47xhy93ebw6p5wmpgzft",
            "tnqie9gonwq93w6im7aa6twkx3",
            "5ejjk68kwir4ce1qx9i5rfad4e",
            "5398173xfouk5q7qsffpaouxb9",
            "7xydpx4t5hu38khyoxbke55ceh",
            "j1msych7q8mpdgfc49n9wi736n",
            "f7tnt6re9oa4ajs3jnsos78783",
            "d5na8j7cqtsf1td7diiwbnbct5",
            "rbnbh5io95csqs5oxzkgo6paej",
            "zdbhfmohkmq7ryg48bhb9af336",
            "x6rq9ojroskd3z8fnitc1mqs8z",
            "7ipwcp5gfiuwn41dhggw8cbn3y",
            "rjm6aweeujb7co18uk5ad6rxj1",
            "grasg5dujbwhg94oh9b1qqontz",
            "ni19g1ddbui9ir1d6cxwsfiou9",
            "eqg8jp3wwg6cjnkd3wt67hgjpy",
            "919iy85ge57rofosr4opp6toqi",
            "fz4pi99yswuqf5nugoocduxe1j",
            "h3p8r8ayn7zp45ngn6zuwq697i",
            "nags9dpp6713wc4mbcfesoijy5",
            "r8udijg7mqh4upuuc8ypzwqr4b",
            "8fejncn45qtfpu7as76ma9qw71",
            "7bi8o44wduxm9nhyz8epfe4won"
          ]
        }
      ],
      "bodies": {
        "u7zjkkzky4qtg9r7cfq36rfxb8": "# Orphaned page\n\nNo row in this table has this page's id.\n"
      },
      "unread": [
        {
          "after": "8fejncn45qtfpu7as76ma9qw71",
          "text": "{\"id\":\"677iuxauyueohj6sabf77upah3\",\"problem\":\"Not JSON: this line has no closing brace\",\"rule\":\"reader: line\""
        },
        {
          "after": "8fejncn45qtfpu7as76ma9qw71",
          "text": "[\"A line that is a list, not a row\",\"reader: line\"]"
        },
        {
          "after": "8fejncn45qtfpu7as76ma9qw71",
          "text": "{\"problem\":\"A row without an id\",\"rule\":\"9.1 id\"}"
        },
        {
          "after": "8fejncn45qtfpu7as76ma9qw71",
          "text": "<<<<<<< ours"
        },
        {
          "after": "7bi8o44wduxm9nhyz8epfe4won",
          "text": "======="
        },
        {
          "after": "7bi8o44wduxm9nhyz8epfe4won",
          "text": "{\"id\":\"7bi8o44wduxm9nhyz8epfe4won\",\"problem\":\"Merge conflict: their side (a different line with the same id)\",\"rule\":\"reader: conflict\",\"sku\":\"P35\",\"region\":\"EU\"}"
        },
        {
          "after": "7bi8o44wduxm9nhyz8epfe4won",
          "text": ">>>>>>> theirs"
        }
      ],
      "diagnostics": [
        {
          "rowIndex": -1,
          "code": "field.id-repeated",
          "field": "again",
          "message": "field again has the id fsk5k76m6e4qj, which another field has; it is given a new one, kept when the table is saved"
        },
        {
          "rowIndex": 34,
          "code": "line.repeat-left-out",
          "rowId": "8fejncn45qtfpu7as76ma9qw71",
          "file": "rows/0001.ndjson",
          "text": "{\"id\":\"8fejncn45qtfpu7as76ma9qw71\",\"problem\":\"A line repeated exactly: the copy is left out\",\"rule\":\"reader: repeated id\",\"sku\":\"P34\",\"region\":\"EU\"}",
          "message": "rows/0001.ndjson: line 35 repeats the row \"8fejncn45qtfpu7as76ma9qw71\" before it exactly, and is left out"
        },
        {
          "rowIndex": 35,
          "code": "line.not-json",
          "file": "rows/0001.ndjson",
          "text": "{\"id\":\"677iuxauyueohj6sabf77upah3\",\"problem\":\"Not JSON: this line has no closing brace\",\"rule\":\"reader: line\"",
          "message": "rows/0001.ndjson: line 36 isn't JSON (Expected ',' or '}' after property value in JSON at position 109 (line 1 column 110)), and is kept as it is: {\"id\":\"677iuxauyueohj6sabf77upah3\",\"problem\":\"Not JSON: this"
        },
        {
          "rowIndex": 36,
          "code": "line.not-row",
          "file": "rows/0001.ndjson",
          "text": "[\"A line that is a list, not a row\",\"reader: line\"]",
          "message": "rows/0001.ndjson: line 37 isn't a row, and is kept as it is: [\"A line that is a list, not a row\",\"reader: line\"]"
        },
        {
          "rowIndex": 37,
          "code": "id.missing",
          "file": "rows/0001.ndjson",
          "text": "{\"problem\":\"A row without an id\",\"rule\":\"9.1 id\"}",
          "message": "rows/0001.ndjson: line 38 is a row without an id, and is kept as it is: {\"problem\":\"A row without an id\",\"rule\":\"9.1 id\"}"
        },
        {
          "rowIndex": 38,
          "code": "line.conflict-marker",
          "file": "rows/0001.ndjson",
          "text": "<<<<<<< ours",
          "message": "rows/0001.ndjson: line 39 isn't JSON (Unexpected token '<', \"<<<<<<< ours\" is not valid JSON), and is kept as it is: <<<<<<< ours"
        },
        {
          "rowIndex": 40,
          "code": "line.conflict-marker",
          "file": "rows/0001.ndjson",
          "text": "=======",
          "message": "rows/0001.ndjson: line 41 isn't JSON (Unexpected token '=', \"=======\" is not valid JSON), and is kept as it is: ======="
        },
        {
          "rowIndex": 41,
          "code": "line.id-repeated",
          "file": "rows/0001.ndjson",
          "text": "{\"id\":\"7bi8o44wduxm9nhyz8epfe4won\",\"problem\":\"Merge conflict: their side (a different line with the same id)\",\"rule\":\"reader: conflict\",\"sku\":\"P35\",\"region\":\"EU\"}",
          "message": "rows/0001.ndjson: line 42 repeats the id \"7bi8o44wduxm9nhyz8epfe4won\" of a row before it, and is kept as it is: {\"id\":\"7bi8o44wduxm9nhyz8epfe4won\",\"problem\":\"Merge conflict",
          "rowId": "7bi8o44wduxm9nhyz8epfe4won"
        },
        {
          "rowIndex": 42,
          "code": "line.conflict-marker",
          "file": "rows/0001.ndjson",
          "text": ">>>>>>> theirs",
          "message": "rows/0001.ndjson: line 43 isn't JSON (Unexpected token '>', \">>>>>>> theirs\" is not valid JSON), and is kept as it is: >>>>>>> theirs"
        },
        {
          "rowIndex": 5,
          "code": "cell.line-unreadable",
          "file": "cells/0001.ndjson",
          "text": "{\"id\": \"a line of cells/ cut short",
          "message": "cells/0001.ndjson: line 6 isn't a cell's formula or note, and is kept as it is: {\"id\": \"a line of cells/ cut short"
        },
        {
          "rowIndex": -1,
          "code": "cell.no-field",
          "rowId": "x6rq9ojroskd3z8fnitc1mqs8z",
          "field": "nope",
          "message": "the formula of nope in row x6rq9ojroskd3z8fnitc1mqs8z is kept, but there's no field nope"
        },
        {
          "rowIndex": -1,
          "code": "cell.no-row",
          "rowId": "w4o9qszq5h79b7zuoit7knpjji",
          "field": "amount",
          "message": "the formula of amount in row w4o9qszq5h79b7zuoit7knpjji is kept, but there's no row w4o9qszq5h79b7zuoit7knpjji"
        },
        {
          "rowIndex": -1,
          "code": "cell.repeated",
          "rowId": "919iy85ge57rofosr4opp6toqi",
          "field": "amount",
          "message": "the formula of amount in row 919iy85ge57rofosr4opp6toqi is there twice; the first is used, and line 4 is kept"
        },
        {
          "rowIndex": -1,
          "code": "cell.typed-over",
          "rowId": "fz4pi99yswuqf5nugoocduxe1j",
          "field": "amount",
          "message": "the formula of amount in row fz4pi99yswuqf5nugoocduxe1j has a value typed over it, which is used; the formula goes when the table is saved"
        }
      ]
    },
    "people": {
      "schema": {
        "fields": [
          {
            "id": "1dhcqynhh739g",
            "name": "name",
            "type": "string"
          }
        ]
      },
      "rows": [
        {
          "id": "i3isneqd9jt7zsdc5pn6wqjpsk",
          "name": "Sam"
        },
        {
          "id": "wxbhqmt3f7oumozobcsmkfixky",
          "name": "Alex"
        }
      ],
      "views": [],
      "meta": {},
      "path": "fixtures/schema-errors.table/tables/people",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "i3isneqd9jt7zsdc5pn6wqjpsk",
            "wxbhqmt3f7oumozobcsmkfixky"
          ]
        }
      ],
      "diagnostics": [
        {
          "rowIndex": -1,
          "code": "file.malformed",
          "file": "meta.json",
          "message": "malformed meta.json, using defaults: Expected double-quoted property name in JSON at position 20 (line 2 column 1)"
        }
      ]
    }
  },
  "diagnostics": [
    {
      "rowIndex": -1,
      "code": "bundle.not-a-table",
      "file": "tables/notes",
      "message": "tables/notes isn't a table: it needs schema.json and rows/"
    }
  ],
  "path": "fixtures/schema-errors.table"
};
