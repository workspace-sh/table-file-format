// Generated from fixtures/tasks.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedTable } from "@workspace.sh/table-core";

export const tasksTable: ParsedTable = {
  "schema": {
    "fields": [
      {
        "name": "title",
        "type": "string",
        "constraints": {
          "required": true
        }
      },
      {
        "name": "project",
        "type": "string",
        "relation": {
          "table": "projects",
          "field": "id"
        }
      },
      {
        "name": "status",
        "type": "string",
        "constraints": {
          "enum": [
            "todo",
            "doing",
            "done"
          ]
        }
      },
      {
        "name": "priority",
        "type": "integer",
        "constraints": {
          "minimum": 1,
          "maximum": 5
        }
      },
      {
        "name": "assignee",
        "type": "string"
      }
    ],
    "primaryKey": [
      "title"
    ],
    "schema-version": 1
  },
  "rows": [
    {
      "id": "t1",
      "title": "Land .table extension",
      "project": "p2",
      "status": "done",
      "priority": 1,
      "assignee": "leslie"
    },
    {
      "id": "t2",
      "title": "Wire RSD + StyleX",
      "project": "p2",
      "status": "doing",
      "priority": 2,
      "assignee": "leslie"
    },
    {
      "id": "t3",
      "title": "Fixtures + tests",
      "project": "p2",
      "status": "doing",
      "priority": 3,
      "assignee": "claude"
    },
    {
      "id": "t4",
      "title": "Settings panel",
      "project": "p1",
      "status": "todo",
      "priority": 2,
      "assignee": "leslie"
    },
    {
      "id": "t5",
      "title": "Markdown editor polish",
      "project": "p1",
      "status": "doing",
      "priority": 1,
      "assignee": "sam"
    },
    {
      "id": "t6",
      "title": "App icon",
      "project": "p3",
      "status": "todo",
      "priority": 3,
      "assignee": "sam"
    },
    {
      "id": "t7",
      "title": "Sync conflict resolution",
      "project": "p5",
      "status": "todo",
      "priority": 4,
      "assignee": "claude"
    },
    {
      "id": "t8",
      "title": "OG images",
      "project": "p7",
      "status": "done",
      "priority": 5,
      "assignee": "sam"
    }
  ],
  "views": [
    {
      "id": "v1",
      "name": "All tasks by priority",
      "layout": "table",
      "sort": [
        {
          "field": "priority",
          "direction": "asc"
        }
      ]
    },
    {
      "id": "v2",
      "name": "Board by status",
      "layout": "board",
      "board_field": "status"
    }
  ],
  "meta": {
    "format": "table",
    "formatVersion": 1,
    "title": "Tasks",
    "generator": "table-file-format spike fixture"
  },
  "path": "fixtures/tasks.table"
};
