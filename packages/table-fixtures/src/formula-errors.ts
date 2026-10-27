// Generated from fixtures/formula-errors.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const formulaErrorsBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
    "title": "Formula errors",
    "tables": [
      "errors"
    ]
  },
  "tables": {
    "errors": {
      "schema": {
        "fields": [
          {
            "id": "f44niqpb14e1q",
            "name": "problem",
            "type": "string"
          },
          {
            "id": "ysxathwnt5dem",
            "name": "n",
            "type": "number"
          },
          {
            "id": "fqjptzycigxiu",
            "name": "result",
            "type": "number"
          },
          {
            "id": "kaomy8kbn9pfk",
            "name": "date",
            "type": "date"
          },
          {
            "id": "kf7dtstcyihws",
            "name": "whole",
            "type": "integer"
          },
          {
            "id": "cy8hcgxt4d6jy",
            "name": "yes_no",
            "type": "boolean"
          },
          {
            "id": "ypaajenhdoxh7",
            "name": "text",
            "type": "string"
          },
          {
            "id": "qbfq7xngcxpwf",
            "name": "point",
            "type": "geopoint"
          }
        ]
      },
      "rows": [
        {
          "id": "jptf3xu8dxq6fo55jrx5ka956b",
          "problem": "Divide by zero",
          "n": 3
        },
        {
          "id": "p8reozp6xtbez7x9zostb6jhtr",
          "problem": "Overflow",
          "n": 3
        },
        {
          "id": "mjwqcpte6snrur6iqsa3k9n5c4",
          "problem": "Text in a sum",
          "n": 3
        },
        {
          "id": "t4eo113reofpsh1ru54hgksean",
          "problem": "Not a true/false in if",
          "n": 3
        },
        {
          "id": "61kwtcaktonbgwf8h1cx7dr736",
          "problem": "Wrong number of arguments",
          "n": 3
        },
        {
          "id": "g48oqd7nec7umpr6a5gxetaj5t",
          "problem": "Unknown function",
          "n": 3
        },
        {
          "id": "3yur8asyznd6z1p4ek9kawngka",
          "problem": "Missing field",
          "n": 3
        },
        {
          "id": "dzzj31e15s7wmmr5yq8x14tn1n",
          "problem": "Missing row",
          "n": 3
        },
        {
          "id": "x5topoju6nfx514xurc9mdfbhj",
          "problem": "Missing table",
          "n": 3
        },
        {
          "id": "phb16i3yxydndeq7oy4xgm7zud",
          "problem": "Missing Sheet view",
          "n": 3
        },
        {
          "id": "1ej3bnytdhdbo4i158xmzw9mxz",
          "problem": "Past the Sheet's edge",
          "n": 3
        },
        {
          "id": "hpe8hzrn4jhwek7hkqss4beckp",
          "problem": "Column not in the Sheet",
          "n": 3
        },
        {
          "id": "rjspe7qwtug3bn9jwz9cdf6tej",
          "problem": "Loop",
          "n": 3
        },
        {
          "id": "ipjbmsnhtdagttwpeknfwpxrwm",
          "problem": "Loop (other half)",
          "n": 3
        },
        {
          "id": "qxdm6e9uspptqwhwb54pzw5bwr",
          "problem": "Date column, number given",
          "n": 3
        },
        {
          "id": "oatbcz1bau33141odzz7gm8cte",
          "problem": "Whole-number column",
          "n": 3
        },
        {
          "id": "ks5oftw5yawe69icixdyz1fnht",
          "problem": "True/false column",
          "n": 3
        },
        {
          "id": "x5pqi3iomy4mfam83wxpp7shrk",
          "problem": "Text column",
          "n": 3
        },
        {
          "id": "cab8jj5uq3n4x83sptekxchmnf",
          "problem": "Map point column",
          "n": 3
        }
      ],
      "views": [
        {
          "id": "hnmryzi51j6jz",
          "name": "All errors",
          "layout": "table",
          "fields": [
            "problem",
            "result",
            "date",
            "whole",
            "yes_no",
            "text",
            "point"
          ],
          "columnWidths": {
            "problem": 230,
            "result": 200,
            "date": 170,
            "whole": 190,
            "yes_no": 170,
            "text": 150,
            "point": 170
          }
        },
        {
          "id": "zp5fa754dua5z",
          "name": "Grid",
          "layout": "table",
          "coordinates": true,
          "fields": [
            "problem",
            "n"
          ]
        }
      ],
      "meta": {
        "title": "Every error"
      },
      "path": "fixtures/formula-errors.table/tables/errors",
      "cells": [
        {
          "id": "jptf3xu8dxq6fo55jrx5ka956b",
          "field": "result",
          "expr": "(/ n 0)"
        },
        {
          "id": "p8reozp6xtbez7x9zostb6jhtr",
          "field": "result",
          "expr": "(* 1e300 1e300)"
        },
        {
          "id": "mjwqcpte6snrur6iqsa3k9n5c4",
          "field": "result",
          "expr": "(+ n \"x\")"
        },
        {
          "id": "t4eo113reofpsh1ru54hgksean",
          "field": "result",
          "expr": "(if n 1 2)"
        },
        {
          "id": "61kwtcaktonbgwf8h1cx7dr736",
          "field": "result",
          "expr": "(round)"
        },
        {
          "id": "g48oqd7nec7umpr6a5gxetaj5t",
          "field": "result",
          "expr": "(frobnicate n)"
        },
        {
          "id": "3yur8asyznd6z1p4ek9kawngka",
          "field": "result",
          "expr": "(* cost 2)"
        },
        {
          "id": "dzzj31e15s7wmmr5yq8x14tn1n",
          "field": "result",
          "expr": "(field \"n\" \"r99\")"
        },
        {
          "id": "x5topoju6nfx514xurc9mdfbhj",
          "field": "result",
          "expr": "(linked \"deals\" \"company\" \"value\")"
        },
        {
          "id": "phb16i3yxydndeq7oy4xgm7zud",
          "field": "result",
          "expr": "(at \"n\" 0 \"nope\")"
        },
        {
          "id": "1ej3bnytdhdbo4i158xmzw9mxz",
          "field": "result",
          "expr": "(row (at \"n\" -50 \"zp5fa754dua5z\"))"
        },
        {
          "id": "hpe8hzrn4jhwek7hkqss4beckp",
          "field": "result",
          "expr": "(sum (range \"n\" 0 \"whole\" 1 \"zp5fa754dua5z\"))"
        },
        {
          "id": "rjspe7qwtug3bn9jwz9cdf6tej",
          "field": "result",
          "expr": "(+ (field \"result\" \"ipjbmsnhtdagttwpeknfwpxrwm\") 1)"
        },
        {
          "id": "ipjbmsnhtdagttwpeknfwpxrwm",
          "field": "result",
          "expr": "(+ (field \"result\" \"rjspe7qwtug3bn9jwz9cdf6tej\") 1)"
        },
        {
          "id": "qxdm6e9uspptqwhwb54pzw5bwr",
          "field": "date",
          "expr": "(+ n 1)"
        },
        {
          "id": "oatbcz1bau33141odzz7gm8cte",
          "field": "whole",
          "expr": "(/ n 4)"
        },
        {
          "id": "ks5oftw5yawe69icixdyz1fnht",
          "field": "yes_no",
          "expr": "(+ n 1)"
        },
        {
          "id": "x5pqi3iomy4mfam83wxpp7shrk",
          "field": "text",
          "expr": "(+ n 1)"
        },
        {
          "id": "cab8jj5uq3n4x83sptekxchmnf",
          "field": "point",
          "expr": "(+ n 1)"
        }
      ],
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "jptf3xu8dxq6fo55jrx5ka956b",
            "p8reozp6xtbez7x9zostb6jhtr",
            "mjwqcpte6snrur6iqsa3k9n5c4",
            "t4eo113reofpsh1ru54hgksean",
            "61kwtcaktonbgwf8h1cx7dr736",
            "g48oqd7nec7umpr6a5gxetaj5t",
            "3yur8asyznd6z1p4ek9kawngka",
            "dzzj31e15s7wmmr5yq8x14tn1n",
            "x5topoju6nfx514xurc9mdfbhj",
            "phb16i3yxydndeq7oy4xgm7zud",
            "1ej3bnytdhdbo4i158xmzw9mxz",
            "hpe8hzrn4jhwek7hkqss4beckp",
            "rjspe7qwtug3bn9jwz9cdf6tej",
            "ipjbmsnhtdagttwpeknfwpxrwm",
            "qxdm6e9uspptqwhwb54pzw5bwr",
            "oatbcz1bau33141odzz7gm8cte",
            "ks5oftw5yawe69icixdyz1fnht",
            "x5pqi3iomy4mfam83wxpp7shrk",
            "cab8jj5uq3n4x83sptekxchmnf"
          ]
        }
      ]
    }
  },
  "path": "fixtures/formula-errors.table"
};
