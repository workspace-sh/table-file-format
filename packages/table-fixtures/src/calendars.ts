// Generated from fixtures/calendars.table by scripts/generate.ts. Don't edit: change
// the fixture and run `npm run generate -w @workspace.sh/table-fixtures`.
import type { ParsedBundle } from "@workspace.sh/table-core";

export const calendarsBundle: ParsedBundle = {
  "meta": {
    "format": "table",
    "formatVersion": 3,
    "title": "Calendars",
    "description": "Every case a calendar view has to draw: times, overlaps, spans, busy days, undated rows and awkward dates.",
    "tables": [
      "events",
      "milestones"
    ],
    "created_at": "2026-11-22T00:00:00Z",
    "modified_at": "2026-11-22T00:00:00Z",
    "generator": "table-file-format fixture"
  },
  "tables": {
    "events": {
      "schema": {
        "fields": [
          {
            "id": "hf9cfse4ym9gi",
            "name": "title",
            "type": "string",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "tzg9m5qut8hpd",
            "name": "kind",
            "type": "string",
            "categories": [
              {
                "value": "Work",
                "color": "blue"
              },
              {
                "value": "Personal",
                "color": "green"
              },
              {
                "value": "Travel",
                "color": "orange"
              },
              {
                "value": "Holiday",
                "color": "purple"
              }
            ]
          },
          {
            "id": "388ctekf9nczf",
            "name": "start",
            "type": "datetime",
            "title": "Starts"
          },
          {
            "id": "mp44u4oi5x14n",
            "name": "end",
            "type": "datetime",
            "title": "Ends"
          },
          {
            "id": "nbd98nex6ffpq",
            "name": "place",
            "type": "string",
            "title": "Place"
          },
          {
            "id": "8pqrfnukumyg8",
            "name": "case",
            "type": "string",
            "title": "What it tests"
          }
        ],
        "primaryKey": [
          "title"
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "1jqx3i87muku79kfxko85esdz1",
          "title": "Team stand-up Mon",
          "kind": "Work",
          "start": "2026-11-23T09:30:00",
          "end": "2026-11-23T09:45:00",
          "place": "Studio",
          "case": "A short entry"
        },
        {
          "id": "yurak7pd4majxuheyf1mgaiw6c",
          "title": "Design review",
          "kind": "Work",
          "start": "2026-11-23T10:00:00",
          "end": "2026-11-23T11:30:00",
          "place": "Studio",
          "case": "Overlaps the next two"
        },
        {
          "id": "4ypty1e5ph38yto7uqkr55ge6z",
          "title": "Client call",
          "kind": "Work",
          "start": "2026-11-23T10:30:00",
          "end": "2026-11-23T11:00:00",
          "place": "Video",
          "case": "Second of three side by side"
        },
        {
          "id": "c1ce9f4qrpqs1f1czbejdyc4jm",
          "title": "Dentist",
          "kind": "Personal",
          "start": "2026-11-23T11:00:00",
          "end": "2026-11-23T11:45:00",
          "place": "High Street",
          "case": "Third of three side by side"
        },
        {
          "id": "7n5zc3s7en847ffu8om3n5gyi5",
          "title": "Lunch with Sam",
          "kind": "Personal",
          "start": "2026-11-23T13:00:00",
          "end": "2026-11-23T14:00:00",
          "place": "Corner Café",
          "case": "After a gap"
        },
        {
          "id": "shprzhsyc5mi111fjin4m34r6x",
          "title": "No end given",
          "kind": "Work",
          "start": "2026-11-24T14:00:00",
          "place": "Studio",
          "case": "Drawn an hour long"
        },
        {
          "id": "g5fy8ogdq5t9qux9ycgnd8k8x7",
          "title": "Early flight",
          "kind": "Travel",
          "start": "2026-11-25T05:45:00",
          "end": "2026-11-25T08:10:00",
          "place": "Airport",
          "case": "Widens the hours earlier"
        },
        {
          "id": "n3d873ysbu58e97odx6cd81dkp",
          "title": "Late release",
          "kind": "Work",
          "start": "2026-11-25T21:00:00",
          "end": "2026-11-25T23:30:00",
          "place": "Home",
          "case": "Widens the hours later"
        },
        {
          "id": "gw4drps85sd59bs4w75m8xi4f8",
          "title": "Night shift",
          "kind": "Work",
          "start": "2026-11-26T22:00:00",
          "end": "2026-11-27T06:00:00",
          "place": "Studio",
          "case": "Crosses midnight"
        },
        {
          "id": "8wwgiu7iynqc347azsa5q1wc8i",
          "title": "Call with Tokyo",
          "kind": "Work",
          "start": "2026-11-27T08:00:00+09:00",
          "end": "2026-11-27T09:00:00+09:00",
          "place": "Video",
          "case": "A written offset, shown as written"
        },
        {
          "id": "9j5wsx67nm47r3juw4f51sqjfa",
          "title": "UTC sync",
          "kind": "Work",
          "start": "2026-11-27T15:00:00Z",
          "end": "2026-11-27T15:30:00Z",
          "place": "Video",
          "case": "A UTC time"
        },
        {
          "id": "x8kdn6a8aa4t3kceysrkty9zne",
          "title": "End before start",
          "kind": "Work",
          "start": "2026-11-28T12:00:00",
          "end": "2026-11-28T10:00:00",
          "place": "Studio",
          "case": "A reversed end is one entry at its start"
        },
        {
          "id": "fo9syfkua63n6x35firnunhj9a",
          "title": "Lisbon conference",
          "kind": "Travel",
          "start": "2026-12-07T09:00:00",
          "end": "2026-12-11T17:00:00",
          "place": "Lisbon",
          "case": "A timed entry over five days"
        },
        {
          "id": "bk4hmrrwf4fyraotyn38oh43q4",
          "title": "Weekend away",
          "kind": "Personal",
          "start": "2026-12-12T18:00:00",
          "end": "2026-12-14T10:00:00",
          "place": "Coast",
          "case": "Spans a week's edge"
        },
        {
          "id": "7bec7ot68zhur9n9hopisyc479",
          "title": "Year-end trip",
          "kind": "Travel",
          "start": "2026-12-29T08:00:00",
          "end": "2027-01-03T20:00:00",
          "place": "Madeira",
          "case": "Spans a month and a year"
        },
        {
          "id": "t9f7wmydxkhquiuy54o4ociapq",
          "title": "Clocks change brunch",
          "kind": "Personal",
          "start": "2027-03-28T01:30:00",
          "end": "2027-03-28T03:30:00",
          "place": "Home",
          "case": "On a daylight-saving day"
        },
        {
          "id": "7tsup434aehkj6bbnf1cyb9wfw",
          "title": "Leap day party",
          "kind": "Personal",
          "start": "2028-02-29T19:00:00",
          "end": "2028-02-29T23:00:00",
          "place": "Home",
          "case": "On a leap day"
        },
        {
          "id": "7ywdc73jwi93px7yyxt8rddz3h",
          "title": "Unscheduled workshop",
          "kind": "Work",
          "case": "No date: in the No Date list"
        },
        {
          "id": "uuu55uhn1r8z9d68fn9durywdz",
          "title": "Someday trip",
          "kind": "Travel",
          "place": "Japan",
          "case": "No date: in the No Date list"
        },
        {
          "id": "3hso8rxsee8t911gehdjk19tzy",
          "title": "Busy day item 1",
          "kind": "Work",
          "start": "2026-12-02T09:00:00",
          "end": "2026-12-02T10:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "qqkyq54ocni7tu4pxyi7byk4gb",
          "title": "Busy day item 2",
          "kind": "Personal",
          "start": "2026-12-02T10:00:00",
          "end": "2026-12-02T11:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "3zjgkgtfz1yodgjunngaftbayx",
          "title": "Busy day item 3",
          "kind": "Work",
          "start": "2026-12-02T11:00:00",
          "end": "2026-12-02T12:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "96y9uasymniwp5q6444116e4ke",
          "title": "Busy day item 4",
          "kind": "Personal",
          "start": "2026-12-02T12:00:00",
          "end": "2026-12-02T13:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "i8jufty5jaqzrqihepwkpc5563",
          "title": "Busy day item 5",
          "kind": "Work",
          "start": "2026-12-02T13:00:00",
          "end": "2026-12-02T14:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "dsap96btb346zu1uze9rk4kwmx",
          "title": "Busy day item 6",
          "kind": "Personal",
          "start": "2026-12-02T14:00:00",
          "end": "2026-12-02T15:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "uoc1kneq8syb1xqxcptr1t6kxi",
          "title": "Busy day item 7",
          "kind": "Work",
          "start": "2026-12-02T15:00:00",
          "end": "2026-12-02T16:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "67opxgysc3tjcrun4kb5nyq5d1",
          "title": "Busy day item 8",
          "kind": "Personal",
          "start": "2026-12-02T16:00:00",
          "end": "2026-12-02T17:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        },
        {
          "id": "onyh7iodsz8gb19qdftok5zf7b",
          "title": "Busy day item 9",
          "kind": "Work",
          "start": "2026-12-02T17:00:00",
          "end": "2026-12-02T18:30:00",
          "place": "Studio",
          "case": "A day with more than fits"
        }
      ],
      "views": [
        {
          "id": "4o3xeghnb4z7k",
          "name": "Schedule",
          "layout": "calendar",
          "calendar_field": "start",
          "calendar_end_field": "end",
          "colors": [
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Work"
                }
              ],
              "color": "blue"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Personal"
                }
              ],
              "color": "green"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Travel"
                }
              ],
              "color": "orange"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Holiday"
                }
              ],
              "color": "purple"
            }
          ]
        },
        {
          "id": "rt9k16aicojma",
          "name": "Starts only",
          "layout": "calendar",
          "calendar_field": "start",
          "colors": [
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Work"
                }
              ],
              "color": "blue"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Personal"
                }
              ],
              "color": "green"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Travel"
                }
              ],
              "color": "orange"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Holiday"
                }
              ],
              "color": "purple"
            }
          ]
        },
        {
          "id": "qrjym16ikwcto",
          "name": "December only",
          "layout": "calendar",
          "calendar_field": "start",
          "calendar_end_field": "end",
          "calendar_range": {
            "start": "2026-12-01",
            "end": "2026-12-31"
          },
          "colors": [
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Work"
                }
              ],
              "color": "blue"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Personal"
                }
              ],
              "color": "green"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Travel"
                }
              ],
              "color": "orange"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Holiday"
                }
              ],
              "color": "purple"
            }
          ]
        },
        {
          "id": "b78hjihrd38gm",
          "name": "All events",
          "layout": "table",
          "fields": [
            "title",
            "kind",
            "start",
            "end",
            "place",
            "case"
          ]
        }
      ],
      "meta": {
        "title": "Events"
      },
      "path": "fixtures/calendars.table/tables/events",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "1jqx3i87muku79kfxko85esdz1",
            "yurak7pd4majxuheyf1mgaiw6c",
            "4ypty1e5ph38yto7uqkr55ge6z",
            "c1ce9f4qrpqs1f1czbejdyc4jm",
            "7n5zc3s7en847ffu8om3n5gyi5",
            "shprzhsyc5mi111fjin4m34r6x",
            "g5fy8ogdq5t9qux9ycgnd8k8x7",
            "n3d873ysbu58e97odx6cd81dkp",
            "gw4drps85sd59bs4w75m8xi4f8",
            "8wwgiu7iynqc347azsa5q1wc8i",
            "9j5wsx67nm47r3juw4f51sqjfa",
            "x8kdn6a8aa4t3kceysrkty9zne",
            "fo9syfkua63n6x35firnunhj9a",
            "bk4hmrrwf4fyraotyn38oh43q4",
            "7bec7ot68zhur9n9hopisyc479",
            "t9f7wmydxkhquiuy54o4ociapq",
            "7tsup434aehkj6bbnf1cyb9wfw",
            "7ywdc73jwi93px7yyxt8rddz3h",
            "uuu55uhn1r8z9d68fn9durywdz",
            "3hso8rxsee8t911gehdjk19tzy",
            "qqkyq54ocni7tu4pxyi7byk4gb",
            "3zjgkgtfz1yodgjunngaftbayx",
            "96y9uasymniwp5q6444116e4ke",
            "i8jufty5jaqzrqihepwkpc5563",
            "dsap96btb346zu1uze9rk4kwmx",
            "uoc1kneq8syb1xqxcptr1t6kxi",
            "67opxgysc3tjcrun4kb5nyq5d1",
            "onyh7iodsz8gb19qdftok5zf7b"
          ]
        }
      ]
    },
    "milestones": {
      "schema": {
        "fields": [
          {
            "id": "7n3wd1abqcqbc",
            "name": "title",
            "type": "string",
            "constraints": {
              "required": true
            }
          },
          {
            "id": "4rzfyntj69h4r",
            "name": "kind",
            "type": "string",
            "categories": [
              {
                "value": "Work",
                "color": "blue"
              },
              {
                "value": "Personal",
                "color": "green"
              },
              {
                "value": "Travel",
                "color": "orange"
              },
              {
                "value": "Holiday",
                "color": "purple"
              }
            ]
          },
          {
            "id": "gzdjsysixw7b6",
            "name": "from",
            "type": "date",
            "title": "From"
          },
          {
            "id": "i6z6jrdqtj734",
            "name": "to",
            "type": "date",
            "title": "To"
          },
          {
            "id": "15ardktkawpwy",
            "name": "case",
            "type": "string",
            "title": "What it tests"
          }
        ],
        "primaryKey": [
          "title"
        ],
        "schema-version": 1
      },
      "rows": [
        {
          "id": "xegrsex96sun6jhxktq9u5be94",
          "title": "Today-ish review",
          "kind": "Work",
          "from": "2026-11-22",
          "case": "A single all-day entry"
        },
        {
          "id": "gyh8413q63a8ypkywm5jcuckpn",
          "title": "Sprint 24",
          "kind": "Work",
          "from": "2026-11-23",
          "to": "2026-12-04",
          "case": "Spans two weeks"
        },
        {
          "id": "tywxsfxzufj8ah7gj9ni93u8p5",
          "title": "Budget freeze",
          "kind": "Work",
          "from": "2026-11-25",
          "to": "2026-11-27",
          "case": "Stacks under the sprint"
        },
        {
          "id": "mfxkxt3w91zr5r89j3arf4p17s",
          "title": "Visitors staying",
          "kind": "Personal",
          "from": "2026-11-26",
          "to": "2026-11-29",
          "case": "Crosses the weekend"
        },
        {
          "id": "973qyog5arctf55t75r17b94iu",
          "title": "Advent market",
          "kind": "Holiday",
          "from": "2026-11-27",
          "to": "2026-12-23",
          "case": "Spans a month's edge"
        },
        {
          "id": "p1q6h3gekp38ogfn1f6agst9td",
          "title": "Office closed",
          "kind": "Holiday",
          "from": "2026-12-24",
          "to": "2027-01-01",
          "case": "Spans a year's edge"
        },
        {
          "id": "6h6k14r9emjzh53e1t1sg4n6mf",
          "title": "Christmas Day",
          "kind": "Holiday",
          "from": "2026-12-25",
          "case": "One day inside a span"
        },
        {
          "id": "abctr9d9r57sghf4goutygrr4y",
          "title": "New Year's Day",
          "kind": "Holiday",
          "from": "2027-01-01",
          "case": "First of the year"
        },
        {
          "id": "h4omyab1xhb1j54orepn1shi4p",
          "title": "Sprint 25",
          "kind": "Work",
          "from": "2026-12-07",
          "to": "2026-12-18",
          "case": "Follows the last sprint"
        },
        {
          "id": "ecqbr5yadrx3rs9mdgmh3w1hk7",
          "title": "Reversed dates",
          "kind": "Work",
          "from": "2026-12-15",
          "to": "2026-12-10",
          "case": "A reversed end is one day"
        },
        {
          "id": "7yy85864tnmp8bhgwezpwd97ki",
          "title": "Quarter planning",
          "kind": "Work",
          "from": "2027-01-11",
          "to": "2027-01-15",
          "case": "One working week"
        },
        {
          "id": "wcncfy5igwxbiz16uh8qrmqiyz",
          "title": "Long project",
          "kind": "Work",
          "from": "2027-01-04",
          "to": "2027-03-26",
          "case": "A bar across many weeks"
        },
        {
          "id": "bib8zaq3rrbp87ptrwwodog5ia",
          "title": "Month start",
          "kind": "Personal",
          "from": "2027-02-01",
          "case": "On a month's first day"
        },
        {
          "id": "cdkuxs71fmczzew53yw8ubusf4",
          "title": "Month end",
          "kind": "Personal",
          "from": "2027-02-28",
          "case": "On a short month's last day"
        },
        {
          "id": "oxcbh9eoozgfznh93f947ohk9f",
          "title": "Leap day deadline",
          "kind": "Work",
          "from": "2028-02-29",
          "case": "On a leap day"
        },
        {
          "id": "589sdyojh8ogyumdkjcc3ukk45",
          "title": "Long ago",
          "kind": "Personal",
          "from": "1999-12-31",
          "case": "Far from today"
        },
        {
          "id": "557piz6dmmdpog1ef4o79d7yti",
          "title": "Far ahead",
          "kind": "Personal",
          "from": "2040-06-15",
          "case": "A jump to a distant date"
        },
        {
          "id": "6jgd5stye1r873wf7or4d6zmyw",
          "title": "A title long enough that it has to be cut short in any day cell of the month",
          "kind": "Work",
          "from": "2026-12-03",
          "to": "2026-12-03",
          "case": "A very long title"
        },
        {
          "id": "chhqqaak47qbzmuukhcuaswxgo",
          "title": "日本語のタイトル",
          "kind": "Personal",
          "from": "2026-12-05",
          "case": "Non-Latin text"
        },
        {
          "id": "tfkj6kdmdwaiiyfsgm9wsrjog3",
          "title": "عنوان بالعربية",
          "kind": "Personal",
          "from": "2026-12-06",
          "case": "Right-to-left text"
        },
        {
          "id": "m8ddkkbxtdpdq311n7xctw918b",
          "title": "Not scheduled yet",
          "kind": "Work",
          "case": "No date: in the No Date list"
        }
      ],
      "views": [
        {
          "id": "6upq9tqutnqp3",
          "name": "Timeline",
          "layout": "calendar",
          "calendar_field": "from",
          "calendar_end_field": "to",
          "colors": [
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Work"
                }
              ],
              "color": "blue"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Personal"
                }
              ],
              "color": "green"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Travel"
                }
              ],
              "color": "orange"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Holiday"
                }
              ],
              "color": "purple"
            }
          ]
        },
        {
          "id": "sdowr4syxsgic",
          "name": "Single days",
          "layout": "calendar",
          "calendar_field": "from",
          "colors": [
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Work"
                }
              ],
              "color": "blue"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Personal"
                }
              ],
              "color": "green"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Travel"
                }
              ],
              "color": "orange"
            },
            {
              "filter": [
                {
                  "field": "kind",
                  "operator": "eq",
                  "value": "Holiday"
                }
              ],
              "color": "purple"
            }
          ]
        },
        {
          "id": "dg6eshmd5j8kj",
          "name": "All milestones",
          "layout": "table",
          "fields": [
            "title",
            "kind",
            "from",
            "to",
            "case"
          ]
        }
      ],
      "meta": {
        "title": "Milestones"
      },
      "path": "fixtures/calendars.table/tables/milestones",
      "rowFiles": [
        {
          "name": "0001.ndjson",
          "ids": [
            "xegrsex96sun6jhxktq9u5be94",
            "gyh8413q63a8ypkywm5jcuckpn",
            "tywxsfxzufj8ah7gj9ni93u8p5",
            "mfxkxt3w91zr5r89j3arf4p17s",
            "973qyog5arctf55t75r17b94iu",
            "p1q6h3gekp38ogfn1f6agst9td",
            "6h6k14r9emjzh53e1t1sg4n6mf",
            "abctr9d9r57sghf4goutygrr4y",
            "h4omyab1xhb1j54orepn1shi4p",
            "ecqbr5yadrx3rs9mdgmh3w1hk7",
            "7yy85864tnmp8bhgwezpwd97ki",
            "wcncfy5igwxbiz16uh8qrmqiyz",
            "bib8zaq3rrbp87ptrwwodog5ia",
            "cdkuxs71fmczzew53yw8ubusf4",
            "oxcbh9eoozgfznh93f947ohk9f",
            "589sdyojh8ogyumdkjcc3ukk45",
            "557piz6dmmdpog1ef4o79d7yti",
            "6jgd5stye1r873wf7or4d6zmyw",
            "chhqqaak47qbzmuukhcuaswxgo",
            "tfkj6kdmdwaiiyfsgm9wsrjog3",
            "m8ddkkbxtdpdq311n7xctw918b"
          ]
        }
      ]
    }
  },
  "path": "fixtures/calendars.table"
};
