import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";
import { Portal } from "./internal/Portal";
import { applyGroup, effectiveAlign, formatAddress } from "@workspace.sh/table-core";
import type {
  Field,
  FieldAlignment,
  ParsedTable,
  Row,
  TableSchema,
  View,
} from "@workspace.sh/table-core";
import { AddFieldButton, SchemaFieldEditor } from "./SchemaEditor";
import { measureAnchor, type AnchorRect } from "./internal/measureAnchor";
import { useContainerWidth } from "./internal/useContainerWidth";
import { useDropTargets } from "./internal/useDropTargets";
import { DragHandle, type DragEvent } from "./internal/DragHandle";
import { HScroll } from "./internal/HScroll";
import { SnapHScroll } from "./internal/SnapHScroll";
import { useViewportWidth } from "./internal/useViewportWidth";
import { BottomSheet } from "./internal/BottomSheet";
import {
  firstDayOfWeek,
  monthNameLong,
  rotateWeekdays,
  weekdayNamesShort,
} from "./internal/calendarLocale";

/**
 * Minimum readable column width. On narrow viewports (mobile portrait)
 * every cell renders at this exact width and the table extends past the
 * viewport → horizontal scroll. On wide viewports (macOS / web) we
 * compute `Math.max(MIN_CELL_WIDTH, viewport / ncols)` so columns fill
 * the available width Airtable-style instead of leaving empty space.
 */
const MIN_CELL_WIDTH = 180;

/**
 * Viewport breakpoint for touch-first UX. Below this width:
 *   - Board view becomes a column carousel (one column per viewport
 *     with a peek of the next).
 *   - DragHandle requires a long-press to activate (so a casual swipe
 *     navigates columns instead of triggering a drag).
 * Picked at 720pt to capture phone-portrait + phone-landscape and
 * tablet-portrait. Above this, the mouse / wide-screen UX takes over.
 */
const TOUCH_VIEWPORT_MAX = 720;
const TOUCH_DRAG_LONGPRESS_MS = 300;

const styles = css.create({
  // Table
  table: {
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    borderRadius: 8,
    overflow: "hidden",
  },
  // Two-pane layout: frozen primary column on the left, horizontally
  // scrollable rest on the right. Lets phones (and wide tables on
  // desktop) keep the primary field visible while panning through
  // other columns — Airtable / Numbers / Sheets pattern.
  tablePanes: {
    display: "flex",
    flexDirection: "row",
  },
  tableFrozenColumn: {
    display: "flex",
    flexDirection: "column",
    // Right border distinguishes the frozen column from the
    // scrollable pane; a subtle shadow would be nicer but needs
    // careful cross-platform handling — defer.
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  tableScrollPane: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    // The HScroll wrapper handles the actual horizontal scroll;
    // this is the column-of-rows it contains.
  },
  // Dynamic cell width — computed per-render from viewport width / ncols.
  // Applied at use-site to both header and body cells so columns align.
  cellWidth: (w: number) => ({
    width: w,
  }),
  tableRow: {
    display: "flex",
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableHeaderRow: {
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
  },
  tableCell: {
    // Width comes from `cellWidth()` function-style — dynamic per render
    // so cells fill wide viewports (macOS / web) and snap to
    // MIN_CELL_WIDTH on mobile (triggering horizontal scroll). Static
    // structural styles only here; width applied at use-site.
    flexShrink: 0,
    flexGrow: 0,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingInline: 16,
    paddingBlock: 10,
    minHeight: 40,
    fontSize: 13,
    boxSizing: "border-box",
    // Subtle inset when the cell contains a focused descendant (i.e. the
    // input is open). Indicator lives on the cell, not on the input, so
    // the input itself can stay layout-neutral and the text doesn't shift
    // on edit-mode swap. :focus-within is CSS-only — RN port via the same
    // useFocused hook pattern documented in strict.css.
    ":focus-within": {
      boxShadow: {
        default: "inset 0 0 0 1px #9ca3af",
        "@media (prefers-color-scheme: dark)": "inset 0 0 0 1px #6b7280",
      },
    },
  },
  tableCellAlignCenter: {
    justifyContent: "center",
    textAlign: "center",
  },
  tableCellAlignRight: {
    justifyContent: "flex-end",
    textAlign: "right",
  },
  tableCellSeparator: {
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },

  // Board
  board: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    overflowX: "auto",
    paddingBottom: 8,
  },
  boardColumn: {
    display: "flex",
    flexDirection: "column",
    minWidth: 240,
    maxWidth: 280,
    padding: 12,
    borderRadius: 8,
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    gap: 8,
  },
  // Used when the board renders as a column carousel on narrow
  // viewports — the column takes a fixed width sized to ~84% of the
  // viewport so the next column peeks. min/max from `boardColumn`
  // would clamp this to 240-280 which defeats the purpose; override.
  boardColumnCarouselWidth: (w: number) => ({
    minWidth: w,
    maxWidth: w,
    width: w,
  }),
  boardColumnDropTarget: {
    borderColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  boardCardWrapper: {
    display: "flex",
    flexDirection: "column",
  },
  cardDragging: {
    opacity: 0.4,
  },
  listItemDragging: {
    opacity: 0.4,
  },
  listItemDropTarget: {
    borderTopWidth: 2,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  draggableHandle: {
    cursor: "grab",
  },

  // Floating ghost — follows the pointer during drag. Rendered via portal
  // so it escapes any clipping ancestor (e.g. table's rounded corners).
  ghost: {
    position: "fixed",
    zIndex: 100,
    pointerEvents: "none",
    width: 240,
    opacity: 0.95,
    borderRadius: 8,
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.25)",
    transform: "rotate(-2deg)",
  },
  ghostPosition: (x: number, y: number) => ({
    left: x,
    top: y,
  }),
  ghostListRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    fontSize: 13,
    fontWeight: "500",
  },
  boardColumnHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
    paddingInline: 4,
    marginBottom: 4,
  },
  boardCount: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "400",
  },

  // Gallery
  gallery: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  galleryCard: {
    // Width applied at use-site via `cellWidth(cardWidth)` — uniform
    // across the grid regardless of how many cards land on the last
    // row. The flex:1 + min/maxWidth pattern (Notion / Airtable
    // default) lets last-row cards stretch wider than the rows above;
    // explicit container-relative widths avoid that.
    flexShrink: 0,
    flexGrow: 0,
    boxSizing: "border-box",
  },
  galleryCardHero: {
    fontSize: 12,
    lineHeight: 1.4,
    color: {
      default: "#3c3c43",
      "@media (prefers-color-scheme: dark)": "#c7c7cc",
    },
    marginBottom: 6,
    paddingInline: 4,
    paddingBlock: 4,
  },

  // List
  list: {
    display: "flex",
    flexDirection: "column",
  },
  listItem: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingBlock: 10,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    gap: 12,
  },
  // Touch-viewport variant — Apple HIG minimum tap target is 44pt
  // (Android Material is 48dp; 44 covers both). Spread alongside
  // `listItem` on narrow viewports.
  listItemTouch: {
    minHeight: 44,
    paddingBlock: 12,
  },
  listItemLast: {
    borderBottomWidth: 0,
  },
  listItemTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  listItemSecondary: {
    fontSize: 12,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },

  // Calendar — month grid (7 cols × 6 rows = 42 cells).
  calendar: {
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    borderRadius: 8,
    overflow: "hidden",
  },
  calendarHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 12,
    paddingBlock: 10,
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  calendarTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  calendarNav: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 16,
    fontWeight: "600",
    cursor: "pointer",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  calendarNavDisabled: {
    opacity: 0.3,
    cursor: "default",
  },
  calendarWeekdays: {
    display: "flex",
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  calendarWeekday: {
    // Width applied at use-site via the `dayCellWidth` function-style.
    // Container-measured (not viewport-derived) so columns track the
    // calendar's actual parent — handles sidebar layouts, narrow
    // panels, orientation changes, browser resize.
    flexShrink: 0,
    flexGrow: 0,
    boxSizing: "border-box",
    paddingBlock: 6,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "center",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  calendarGrid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDay: {
    // Same `dayCellWidth(n)` applied at use-site as the header cells,
    // so headers and grid share identical column geometry.
    flexShrink: 0,
    flexGrow: 0,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minHeight: 80,
    paddingInline: 4,
    paddingBlock: 4,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    gap: 2,
    overflow: "hidden",
  },
  calendarDayOther: {
    opacity: 0.4,
  },
  calendarDayNum: {
    fontSize: 11,
    fontWeight: "500",
    paddingInline: 2,
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  calendarRowChip: {
    fontSize: 10,
    paddingInline: 4,
    paddingBlock: 2,
    borderRadius: 3,
    borderWidth: 0,
    cursor: "pointer",
    textAlign: "left",
    overflow: "hidden",
    backgroundColor: {
      default: "#dbeafe",
      "@media (prefers-color-scheme: dark)": "#1e293b",
    },
    color: {
      default: "#1e40af",
      "@media (prefers-color-scheme: dark)": "#93c5fd",
    },
  },
  // Apple / Google Calendar mobile pattern — day cell shows just a
  // row of small dots indicating event density. Tap the day to open
  // a sheet with the full event list. Less informative at a glance
  // but legible at any cell size.
  calendarDayDots: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  calendarDayDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  calendarDayMore: {
    fontSize: 9,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  // Make the day cell tappable — full-bleed pressable area, no extra
  // affordances; the dots inside hint at content.
  calendarDayButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    paddingInline: 6,
    paddingBlock: 4,
    backgroundColor: "transparent",
    borderWidth: 0,
    cursor: "pointer",
    textAlign: "left",
  },
  // Bottom-sheet event list — one tappable row per event for the
  // selected day.
  daySheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  daySheetItem: {
    paddingInline: 8,
    paddingBlock: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    fontSize: 14,
    backgroundColor: "transparent",
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    cursor: "pointer",
    textAlign: "left",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  daySheetEmpty: {
    paddingInline: 8,
    paddingBlock: 24,
    fontSize: 13,
    textAlign: "center",
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  calendarEmpty: {
    padding: 24,
    textAlign: "center",
    fontSize: 13,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },

  // Card (shared by board + gallery)
  card: {
    display: "flex",
    flexDirection: "column",
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#0e0e10",
    },
    gap: 6,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  cardField: {
    display: "flex",
    flexDirection: "row",
    fontSize: 12,
    gap: 8,
  },
  cardFieldLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    minWidth: 56,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  cardFieldValue: {
    flex: 1,
    fontSize: 12,
  },

  // Pill (for enum values)
  pill: {
    paddingInline: 10,
    paddingBlock: 3,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "500",
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },

  /**
   * Relation cell — looks like a link, opens the target row on click.
   * `html.button` rather than `html.a` so we get cross-platform press
   * handling (RSD maps html.button to Pressable on RN).
   */
  relationLink: {
    paddingInline: 0,
    paddingBlock: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
    color: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    textDecorationLine: "underline",
    textDecorationStyle: "solid",
  },
  /**
   * Dangling relation — the row id has no matching row in the related
   * table (or the table isn't loaded). Surface visibly rather than
   * silently rendering nothing.
   */
  relationBroken: {
    fontStyle: "italic",
    opacity: 0.55,
    color: {
      default: "#c00",
      "@media (prefers-color-scheme: dark)": "#ff6b6b",
    },
    textDecorationLine: "line-through",
    textDecorationStyle: "solid",
  },

  // Clickable header cell wrapper — width applied at use-site via the
  // same cellWidth function-style so headers align with body cells.
  headerCellWrapper: {
    position: "relative",
    display: "flex",
    flexShrink: 0,
    flexGrow: 0,
    overflow: "hidden",
  },
  headerCellButton: {
    flex: 1,
    paddingBlock: 10,
    paddingInline: 16,
    backgroundColor: "transparent",
    borderWidth: 0,
    textAlign: "left",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  headerCellButtonCenter: {
    textAlign: "center",
  },
  headerCellButtonRight: {
    textAlign: "right",
  },
  headerCellDeprecated: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },

  // Editable-cell input — layout-identical to the idle wrapper
  // (cellEditableIdle) so swapping between display and edit doesn't shift
  // anything by even a pixel. Zero padding, zero border, transparent.
  // The focus indicator is on the parent tableCell via :focus-within.
  cellInput: {
    width: "100%",
    paddingInline: 0,
    paddingBlock: 0,
    fontSize: 13,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    outlineStyle: "none",
    minHeight: 22,
    boxSizing: "border-box",
  },
  // Idle (display) wrapper inside an editable cell — fills the cell so
  // clicks anywhere in the cell start editing, not just on the text run.
  cellEditableIdle: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    width: "100%",
    minHeight: 22,
    cursor: "text",
  },

  // Spacer in body rows to mirror the "+ Field" header column slot.
  // Width must match SchemaEditor's `addFieldWrapper.width` — kept as a
  // literal here because StyleX is static-extraction-only and can't
  // resolve cross-module constants inside css.create().
  addFieldSpacer: {
    width: 84,
    flexShrink: 0,
  },

  // "doc" badge for rows with a markdown body — clickable variant overrides
  bodyBadgeButton: {
    borderWidth: 0,
    cursor: "pointer",
  },
  bodyBadge: {
    paddingInline: 6,
    paddingBlock: 1,
    marginLeft: 6,
    borderRadius: 4,
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    backgroundColor: {
      default: "#dbeafe",
      "@media (prefers-color-scheme: dark)": "#1e293b",
    },
    color: {
      default: "#1e40af",
      "@media (prefers-color-scheme: dark)": "#93c5fd",
    },
  },

  // Body excerpt (gallery cards) — clickable when onOpenBody is provided
  bodyExcerptButton: {
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    cursor: "pointer",
    textAlign: "left",
    backgroundColor: "transparent",
  },
  bodyExcerpt: {
    fontSize: 11,
    lineHeight: 1.45,
    color: {
      default: "#3c3c43",
      "@media (prefers-color-scheme: dark)": "#a1a1aa",
    },
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    marginTop: 4,
  },
});

function fieldsByName(schema: TableSchema): Map<string, Field> {
  return new Map(schema.fields.map((f) => [f.name, f]));
}

function visibleFields(view: View, schema: TableSchema): string[] {
  return view.fields ?? schema.fields.map((f) => f.name);
}

function cellAlignStyle(align: FieldAlignment) {
  if (align === "center") return styles.tableCellAlignCenter;
  if (align === "right") return styles.tableCellAlignRight;
  return false as const;
}

function headerAlignStyle(align: FieldAlignment) {
  if (align === "center") return styles.headerCellButtonCenter;
  if (align === "right") return styles.headerCellButtonRight;
  return false as const;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

interface CellValueProps {
  field: Field | undefined;
  value: unknown;
  /** Loaded sibling tables, for resolving relation cells. */
  relatedTables?: Record<string, ParsedTable>;
  /** Called with a row address when a relation cell is clicked. */
  onOpenRelation?: (address: string) => void;
}

function CellValue({ field, value, relatedTables, onOpenRelation }: CellValueProps) {
  // Relation field → resolve to related row, render as link (or
  // broken-state when dangling).
  if (field?.relation && typeof value === "string" && value.length > 0) {
    return (
      <RelationCellValue
        relation={field.relation}
        targetId={value}
        relatedTables={relatedTables}
        onOpenRelation={onOpenRelation}
      />
    );
  }

  const isEnum = field?.constraints?.enum != null;
  if (isEnum && value !== undefined && value !== null && value !== "") {
    return <html.span style={styles.pill}>{String(value)}</html.span>;
  }
  return <html.span>{formatValue(value)}</html.span>;
}

function RelationCellValue({
  relation,
  targetId,
  relatedTables,
  onOpenRelation,
}: {
  relation: { table: string; field: string };
  targetId: string;
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
}) {
  const target = relatedTables?.[relation.table];
  const targetRow = target?.rows.find((r) => r.id === targetId);

  // Display value: the related row's primary-key value when resolvable;
  // otherwise the raw id (broken state).
  const primaryKeyField = target?.schema.primaryKey?.[0];
  const resolvedLabel =
    targetRow && primaryKeyField
      ? String(targetRow[primaryKeyField] ?? targetId)
      : null;

  if (!resolvedLabel) {
    // Dangling — no related table loaded, OR table loaded but row not
    // in it. Render visibly rather than silently.
    return (
      <html.span
        style={styles.relationBroken}
        aria-label={`Dangling: ${relation.table}#row=${targetId}`}
      >
        {targetId}
      </html.span>
    );
  }

  if (!onOpenRelation) {
    // Resolvable but no navigation callback wired up — render the label
    // as plain text (read-only consumer).
    return <html.span>{resolvedLabel}</html.span>;
  }

  // Compose the row address: <table-path>#row=<id>. The table-path
  // here is the relation's declared `table` name; apps that need full
  // paths resolve in their lookup. The format library's relation
  // declaration is the structured form; this string is the
  // serialisation.
  const address = formatAddress({ tablePath: relation.table, rowId: targetId });
  return (
    <html.button
      style={styles.relationLink}
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onOpenRelation(address);
      }}
    >
      {resolvedLabel}
    </html.button>
  );
}

function coerceValue(field: Field | undefined, raw: string): unknown {
  if (!field) return raw;
  switch (field.type) {
    case "integer": {
      const n = Number(raw);
      return Number.isInteger(n) ? n : raw === "" ? null : raw;
    }
    case "number": {
      const n = Number(raw);
      return Number.isNaN(n) ? (raw === "" ? null : raw) : n;
    }
    case "boolean":
      return raw === "true";
    default:
      return raw;
  }
}

interface EditableCellProps {
  field: Field | undefined;
  value: unknown;
  onCommit: (next: unknown) => void;
  /** Forwarded to CellValue for relation-cell rendering in idle state. */
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
}

function EditableCell({
  field,
  value,
  onCommit,
  relatedTables,
  onOpenRelation,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el && "select" in el && typeof el.select === "function") el.select();
      else el?.focus?.();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value === undefined || value === null ? "" : String(value));
    setEditing(true);
  };

  const commit = (raw: string) => {
    setEditing(false);
    const next = coerceValue(field, raw);
    if (next !== value) onCommit(next);
  };

  const cancel = () => setEditing(false);

  // Boolean: toggle on click, no draft state
  if (field?.type === "boolean") {
    return (
      <html.input
        type="checkbox"
        checked={value === true}
        onChange={(e: { target: { checked: boolean } }) => onCommit(e.target.checked)}
      />
    );
  }

  // Enum: select dropdown
  const enumValues = field?.constraints?.enum;
  if (enumValues && enumValues.length > 0) {
    if (!editing) {
      return (
        <html.span onClick={startEdit} style={styles.cellEditableIdle}>
          <CellValue
            field={field}
            value={value}
            relatedTables={relatedTables}
            onOpenRelation={onOpenRelation}
          />
        </html.span>
      );
    }
    return (
      <html.select
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={inputRef as any}
        value={typeof value === "string" ? value : ""}
        onChange={(e: { target: { value: string } }) => commit(e.target.value)}
        onBlur={cancel}
        style={styles.cellInput}
      >
        <html.option value="">—</html.option>
        {enumValues.map((opt) => (
          <html.option key={opt} value={opt}>
            {opt}
          </html.option>
        ))}
      </html.select>
    );
  }

  // Text/number/integer: text input on click
  if (!editing) {
    return (
      <html.span onClick={startEdit} style={styles.cellEditableIdle}>
        <CellValue field={field} value={value} />
      </html.span>
    );
  }

  // Native HTML5 controls for time-shaped fields. On RN these would be
  // swapped for @react-native-community/datetimepicker (or similar); the
  // RSD strict-subset purity is deliberately broken here in favour of
  // platform-native pickers — see PR description.
  const inputType =
    field?.type === "integer" || field?.type === "number"
      ? "number"
      : field?.type === "date"
        ? "date"
        : field?.type === "datetime"
          ? "datetime-local"
          : field?.type === "time"
            ? "time"
            : "text";
  return (
    <html.input
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={inputRef as any}
      type={inputType}
      value={draft}
      onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e: { key: string }) => {
        if (e.key === "Enter") commit(draft);
        else if (e.key === "Escape") cancel();
      }}
      style={styles.cellInput}
    />
  );
}

interface ViewProps {
  view: View;
  rows: Row[];
  schema: TableSchema;
  bodies?: Record<string, string>;
  /**
   * Sibling `.table/` directories indexed by their path (the value
   * stored in a field's `relation.table` declaration). Provided by
   * the consuming app so relation cells can resolve the target row's
   * display value. Cells with no resolvable target render the raw id
   * with a "broken" visual state.
   */
  relatedTables?: Record<string, ParsedTable>;
  onUpdateRow?: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField?: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue?: (fieldName: string, value: string) => void;
  onMoveField?: (fieldName: string, delta: -1 | 1) => void;
  onAddField?: (field: Field) => void;
  onOpenBody?: (rowId: string) => void;
  onUpdateView?: (patch: Partial<View>) => void;
  /**
   * Called when a relation cell is clicked. Address takes the form
   * `<table-path>#row=<id>` (see docs/SPEC.md, "Addressing"). Apps
   * implement to navigate to the target row.
   */
  onOpenRelation?: (address: string) => void;
}

function bodyExcerpt(body: string | undefined, max = 160): string | undefined {
  if (!body) return undefined;
  const stripped = body
    .replace(/^#+\s+/gm, "") // drop leading markdown heading hashes
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Floating ghost that follows the pointer during drag. Rendered via the
 * cross-platform `Portal` so it escapes any clipping ancestor (e.g. the
 * table's rounded `overflow: hidden`).
 */
function DragGhost({
  pointerPos,
  children,
}: {
  pointerPos: { x: number; y: number } | null;
  children: ReactNode;
}) {
  if (!pointerPos) return null;
  return (
    <Portal>
      <html.div
        style={[styles.ghost, styles.ghostPosition(pointerPos.x + 14, pointerPos.y + 14)]}
      >
        {children}
      </html.div>
    </Portal>
  );
}

function BodyBadge({ onClick }: { onClick?: () => void }) {
  if (!onClick) return <html.span style={styles.bodyBadge}>doc</html.span>;
  return (
    <html.button
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onClick();
      }}
      style={[styles.bodyBadge, styles.bodyBadgeButton]}
    >
      doc
    </html.button>
  );
}

export function TableView({
  view,
  rows,
  schema,
  bodies,
  relatedTables,
  onUpdateRow,
  onUpdateField,
  onAddEnumValue,
  onMoveField,
  onAddField,
  onOpenBody,
  onOpenRelation,
}: ViewProps) {
  const fields = visibleFields(view, schema);
  const fieldMap = fieldsByName(schema);
  const titleField = fields[0];
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  // Ref typed loosely (`unknown`) because the underlying instance differs
  // per platform — HTMLButtonElement on web, a Pressable view ref on
  // native. measureAnchor() handles the platform-specific measurement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerButtonRefs = useRef<Record<string, any>>({});
  const schemaEditable = !!(onUpdateField && onAddEnumValue && onMoveField);
  const canAddField = !!onAddField;
  const lastFieldThreshold = Math.max(0, schema.fields.length - 2);

  // Responsive cell width: cells fill the table's CONTAINER when
  // there's room (wide windows) and snap to MIN_CELL_WIDTH on narrow
  // viewports (mobile portrait), triggering horizontal scroll via the
  // consumer's ScrollView wrapper. Reactive via `useContainerWidth`
  // (web: ResizeObserver on the outer table div; native: RN onLayout).
  // Container-measured (not viewport-measured) so a sidebar-narrowed
  // main pane on web gets the right cell sizes, and an embedded
  // table inside a constrained panel does the right thing too.
  const { measureProps, width: containerWidth } = useContainerWidth();
  const totalCols = fields.length + (canAddField ? 1 : 0);
  const cellWidth =
    containerWidth > 0
      ? Math.max(MIN_CELL_WIDTH, Math.floor(containerWidth / totalCols))
      : MIN_CELL_WIDTH;

  // Split fields into primary (frozen, leftmost) + rest (scrollable).
  // Primary is the title field — first in the visible order. Empty
  // tables (no fields) still render a placeholder header.
  const primaryName = fields[0];
  const restNames = fields.slice(1);

  // Cell renderers — extracted because both panes share them.
  const renderHeaderCell = (name: string, idxInPane: number, paneLen: number) => {
    const field = fieldMap.get(name);
    const isEditing = editingFieldName === name;
    const fieldIndex = schema.fields.findIndex((f) => f.name === name);
    const align = effectiveAlign(field);
    // `isLast` controls whether the right-border separator shows. The
    // primary pane never has a right-edge separator (the column's own
    // right border does it); rest-pane cells separate themselves
    // except the last one, where the `+ Field` button takes over.
    const isLast = idxInPane === paneLen - 1 && !canAddField;
    if (!schemaEditable) {
      return (
        <html.span
          key={name}
          style={[
            styles.tableCell,
            styles.cellWidth(cellWidth),
            styles.tableHeaderCell,
            cellAlignStyle(align),
            !isLast && styles.tableCellSeparator,
          ]}
        >
          {field?.title ?? name}
        </html.span>
      );
    }
    return (
      <html.span
        key={name}
        style={[
          styles.headerCellWrapper,
          styles.cellWidth(cellWidth),
          !isLast && styles.tableCellSeparator,
        ]}
      >
        <html.button
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={(el: any) => {
            headerButtonRefs.current[name] = el;
          }}
          onClick={async () => {
            if (isEditing) {
              setEditingFieldName(null);
            } else {
              const rect = await measureAnchor(headerButtonRefs.current[name]);
              if (rect) setAnchorRect(rect);
              setEditingFieldName(name);
            }
          }}
          style={[
            styles.headerCellButton,
            !!field?.deprecated && styles.headerCellDeprecated,
            headerAlignStyle(align),
          ]}
        >
          {field?.title ?? name}
        </html.button>
        {isEditing && field && anchorRect && (
          <SchemaFieldEditor
            field={field}
            fieldIndex={fieldIndex}
            totalFields={schema.fields.length}
            align={fieldIndex >= lastFieldThreshold ? "right" : "left"}
            anchorRect={anchorRect}
            onUpdate={(patch) => onUpdateField!(name, patch)}
            onAddEnumValue={(value) => onAddEnumValue!(name, value)}
            onMove={(delta) => onMoveField!(name, delta)}
            onClose={() => {
              setEditingFieldName(null);
              setAnchorRect(null);
            }}
          />
        )}
      </html.span>
    );
  };

  const renderBodyCell = (
    row: Row,
    name: string,
    idxInPane: number,
    paneLen: number,
  ) => {
    const field = fieldMap.get(name);
    const align = effectiveAlign(field);
    const isLast = idxInPane === paneLen - 1 && !canAddField;
    return (
      <html.span
        key={name}
        style={[
          styles.tableCell,
          styles.cellWidth(cellWidth),
          cellAlignStyle(align),
          !isLast && styles.tableCellSeparator,
        ]}
      >
        {onUpdateRow ? (
          <EditableCell
            field={field}
            value={row[name]}
            onCommit={(next) => onUpdateRow(row.id, name, next)}
            relatedTables={relatedTables}
            onOpenRelation={onOpenRelation}
          />
        ) : (
          <CellValue
            field={field}
            value={row[name]}
            relatedTables={relatedTables}
            onOpenRelation={onOpenRelation}
          />
        )}
        {name === titleField && bodies?.[row.id] ? (
          <BodyBadge onClick={onOpenBody ? () => onOpenBody(row.id) : undefined} />
        ) : null}
      </html.span>
    );
  };

  return (
    <html.div {...measureProps} style={styles.table}>
      <html.div style={styles.tablePanes}>
        {/* Frozen pane: primary (title) field — header + one cell per row,
            stacked vertically. The primary stays put while the user pans
            the rest pane horizontally. */}
        <html.div style={styles.tableFrozenColumn}>
          <html.div style={[styles.tableRow, styles.tableHeaderRow]}>
            {primaryName && renderHeaderCell(primaryName, 0, 1)}
          </html.div>
          {rows.map((row, i) => (
            <html.div
              key={row.id}
              style={[
                styles.tableRow,
                i === rows.length - 1 && styles.tableRowLast,
              ]}
            >
              {primaryName && renderBodyCell(row, primaryName, 0, 1)}
            </html.div>
          ))}
        </html.div>
        {/* Scrollable pane: everything past the primary field, plus the
            `+ Field` affordance. Renders inside HScroll which delivers a
            horizontal scrollbar on web and an RN ScrollView on native. */}
        <html.div style={styles.tableScrollPane}>
          <HScroll>
            <html.div style={styles.tableScrollPane}>
              <html.div style={[styles.tableRow, styles.tableHeaderRow]}>
                {restNames.map((name, idx) =>
                  renderHeaderCell(name, idx, restNames.length),
                )}
                {canAddField && (
                  <AddFieldButton
                    existingNames={new Set(schema.fields.map((f) => f.name))}
                    onAdd={onAddField!}
                  />
                )}
              </html.div>
              {rows.map((row, i) => (
                <html.div
                  key={row.id}
                  style={[
                    styles.tableRow,
                    i === rows.length - 1 && styles.tableRowLast,
                  ]}
                >
                  {restNames.map((name, idx) =>
                    renderBodyCell(row, name, idx, restNames.length),
                  )}
                  {canAddField && <html.div style={styles.addFieldSpacer} />}
                </html.div>
              ))}
            </html.div>
          </HScroll>
        </html.div>
      </html.div>
    </html.div>
  );
}

export function BoardView({
  view,
  rows,
  schema,
  onUpdateRow,
  relatedTables,
  onOpenRelation,
}: ViewProps) {
  const groupField = view.board_field ?? "status";
  const groupFieldDef = schema.fields.find((f) => f.name === groupField);
  const enumValues = groupFieldDef?.constraints?.enum;
  const fields = visibleFields(view, schema).filter((f) => f !== groupField);
  const fieldMap = fieldsByName(schema);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const canDrag = !!onUpdateRow;
  const {
    register: registerColumn,
    hitTest,
    remeasure: remeasureColumns,
  } = useDropTargets<string>();

  // Phone-shaped viewport → column carousel: each column is sized to
  // ~84% of the viewport so the next one peeks at the right edge, and
  // dragging a card requires a long-press so casual horizontal swipes
  // navigate columns instead of starting a drag. Above the breakpoint
  // we fall back to free horizontal scroll with the default 240-280pt
  // columns and immediate drag activation (desktop / wide tablet).
  const viewportWidth = useViewportWidth();
  const isTouchViewport = viewportWidth <= TOUCH_VIEWPORT_MAX;
  // Carousel column width: viewport minus side padding minus peek.
  // 16pt side padding, ~52pt peek of the next column on the right.
  const carouselColumnWidth = Math.max(240, viewportWidth - 16 - 52);
  // Snap interval: column width + the gap between columns (`styles.board.gap`).
  const carouselSnapInterval = carouselColumnWidth + 12;
  const dragLongPressMs = isTouchViewport ? TOUCH_DRAG_LONGPRESS_MS : undefined;

  // Render rows as-is — the dragged card stays in its source column
  // with a "lifted" visual style; only `hoveredColumn` highlights the
  // destination. Mutating displayRows to physically move the dragged
  // card during a drag caused it to obscure subsequent hit-tests on
  // macOS (the moving card sat under the cursor and intercepted every
  // hover detection). Commit on release uses the cursor's final coords
  // via the release-position hit-test in onDragEnd.
  const groups = applyGroup(rows, groupField, schema);

  // Persistent columns: when the group field has an enum, show ALL
  // enum values (even empty ones) so the user can drop into a column
  // with no rows.
  const columnKeys: string[] = enumValues
    ? (() => {
        const keys = [...enumValues];
        for (const k of Object.keys(groups)) {
          if (!keys.includes(k)) keys.push(k);
        }
        return keys;
      })()
    : Object.keys(groups);

  const columnsContent = columnKeys.map((key) => {
    const groupRows = groups[key] ?? [];
    const dropReg = canDrag ? registerColumn(key) : undefined;
    return (
      <html.div
        key={key}
        ref={dropReg?.ref}
        style={[
          styles.boardColumn,
          isTouchViewport && styles.boardColumnCarouselWidth(carouselColumnWidth),
          hoveredColumn === key && draggedRowId !== null && styles.boardColumnDropTarget,
        ]}
      >
        <html.div style={styles.boardColumnHeader}>
          <html.span>{key}</html.span>
          <html.span style={styles.boardCount}>{groupRows.length}</html.span>
        </html.div>
        {groupRows.map((row) => (
          <DragHandle
            key={row.id}
            longPressMs={dragLongPressMs}
            onDragStart={
              canDrag
                ? (e: DragEvent) => {
                    setDraggedRowId(row.id);
                    setHoveredColumn(key);
                    setPointerPos({ x: e.pageX, y: e.pageY });
                    remeasureColumns();
                  }
                : undefined
            }
            onDragMove={
              canDrag
                ? (e: DragEvent) => {
                    setPointerPos({ x: e.pageX, y: e.pageY });
                    const hit = hitTest(e.pageX, e.pageY);
                    setHoveredColumn((prev) => (prev === hit ? prev : hit));
                  }
                : undefined
            }
            onDragEnd={
              canDrag
                ? (e: DragEvent) => {
                    const target = hitTest(e.pageX, e.pageY);
                    if (target && onUpdateRow) {
                      const source = rows.find((r) => r.id === row.id);
                      if (source && source[groupField] !== target) {
                        onUpdateRow(
                          row.id,
                          groupField,
                          target === "(empty)" ? null : target,
                        );
                      }
                    }
                    setDraggedRowId(null);
                    setHoveredColumn(null);
                    setPointerPos(null);
                  }
                : undefined
            }
          >
            <html.div
              style={[
                styles.boardCardWrapper,
                canDrag && styles.draggableHandle,
                draggedRowId === row.id && styles.cardDragging,
              ]}
            >
              <Card
                row={row}
                fields={fields}
                fieldMap={fieldMap}
                relatedTables={relatedTables}
                onOpenRelation={onOpenRelation}
              />
            </html.div>
          </DragHandle>
        ))}
      </html.div>
    );
  });

  const ghost =
    draggedRowId &&
    (() => {
      const row = rows.find((r) => r.id === draggedRowId);
      if (!row) return null;
      return (
        <DragGhost pointerPos={pointerPos}>
          <Card row={row} fields={fields} fieldMap={fieldMap} />
        </DragGhost>
      );
    })();

  // Phone: snap-paging carousel — one column dominates the viewport,
  // peek of next at the right edge, swipe horizontally to advance.
  // Above the touch breakpoint: keep the free-scrolling multi-column
  // layout from the original desktop design.
  if (isTouchViewport) {
    return (
      <>
        <SnapHScroll snapInterval={carouselSnapInterval}>
          <html.div style={styles.board}>{columnsContent}</html.div>
        </SnapHScroll>
        {ghost}
      </>
    );
  }
  return (
    <html.div style={styles.board}>
      {columnsContent}
      {ghost}
    </html.div>
  );
}

/** Minimum readable gallery-card width before we wrap to the next row. */
const MIN_GALLERY_CARD_WIDTH = 240;
/** Gap between gallery cards. Must match `styles.gallery.gap`. */
const GALLERY_GAP = 12;

export function GalleryView({
  view,
  rows,
  schema,
  bodies,
  onOpenBody,
  relatedTables,
  onOpenRelation,
}: ViewProps) {
  const galleryField = view.gallery_field;
  const fields = visibleFields(view, schema).filter((f) => f !== galleryField);
  const fieldMap = fieldsByName(schema);

  // Container-relative uniform card widths. Standard flex:1 + min/maxWidth
  // grid (Notion / Airtable default) lets last-row cards stretch wider
  // than the rows above them; explicit calc avoids that.
  //
  //   cardsPerRow = floor((container + gap) / (minCard + gap))
  //   cardWidth   = (container - (cardsPerRow - 1) * gap) / cardsPerRow
  //
  // The +gap / -gap dance accounts for the (N-1) gaps that sit BETWEEN
  // cards (not trailing the last one in a row).
  const { measureProps, width: containerWidth } = useContainerWidth();
  const cardsPerRow =
    containerWidth > 0
      ? Math.max(
          1,
          Math.floor(
            (containerWidth + GALLERY_GAP) /
              (MIN_GALLERY_CARD_WIDTH + GALLERY_GAP),
          ),
        )
      : 1;
  const cardWidth =
    containerWidth > 0
      ? Math.floor(
          (containerWidth - (cardsPerRow - 1) * GALLERY_GAP) / cardsPerRow,
        )
      : MIN_GALLERY_CARD_WIDTH;

  return (
    <html.div {...measureProps} style={styles.gallery}>
      {rows.map((row) => {
        const excerpt = bodyExcerpt(bodies?.[row.id]);
        const hasBody = !!bodies?.[row.id];
        return (
          <html.div
            key={row.id}
            style={[styles.card, styles.galleryCard, styles.cellWidth(cardWidth)]}
          >
            {galleryField && (
              <html.span style={styles.galleryCardHero}>
                {formatValue(row[galleryField])}
              </html.span>
            )}
            <CardBody
              row={row}
              fields={fields}
              fieldMap={fieldMap}
              relatedTables={relatedTables}
              onOpenRelation={onOpenRelation}
              hideTitle={!!galleryField}
            />
            {excerpt && (
              hasBody && onOpenBody ? (
                <html.button
                  onClick={() => onOpenBody(row.id)}
                  style={[styles.bodyExcerpt, styles.bodyExcerptButton]}
                >
                  {excerpt}
                </html.button>
              ) : (
                <html.span style={styles.bodyExcerpt}>{excerpt}</html.span>
              )
            )}
          </html.div>
        );
      })}
    </html.div>
  );
}

export function ListView({
  view,
  rows,
  schema,
  bodies,
  onOpenBody,
  onUpdateView,
  relatedTables,
  onOpenRelation,
}: ViewProps) {
  const fields = visibleFields(view, schema);
  const titleField = fields[0] ?? schema.fields[0]?.name;
  const secondaryFields = fields.slice(1);
  const fieldMap = fieldsByName(schema);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  // Just track which row the cursor is over — no reorder preview.
  // Rendering rows in their original order keeps the drop targets
  // stationary so hit-tests stay consistent throughout the drag.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const canDrag = !!onUpdateView;
  const viewportWidth = useViewportWidth();
  const dragLongPressMs =
    viewportWidth <= TOUCH_VIEWPORT_MAX ? TOUCH_DRAG_LONGPRESS_MS : undefined;
  const {
    register: registerRow,
    hitTest,
    remeasure: remeasureRows,
  } = useDropTargets<string>();

  const computeOrder = (
    draggedId: string,
    targetRowId: string,
  ): string[] => {
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetRowId);
    if (from === -1 || to === -1) return ids;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  };

  return (
    <html.div style={styles.list}>
      {rows.map((row, i) => {
        const dropReg = canDrag ? registerRow(row.id) : undefined;
        const isDropTarget =
          draggedRowId !== null &&
          hoveredRowId === row.id &&
          hoveredRowId !== draggedRowId;
        return (
          <DragHandle
            key={row.id}
            longPressMs={dragLongPressMs}
            onDragStart={
              canDrag
                ? (e: DragEvent) => {
                    setDraggedRowId(row.id);
                    setHoveredRowId(null);
                    setPointerPos({ x: e.pageX, y: e.pageY });
                    remeasureRows();
                  }
                : undefined
            }
            onDragMove={
              canDrag
                ? (e: DragEvent) => {
                    setPointerPos({ x: e.pageX, y: e.pageY });
                    const target = hitTest(e.pageX, e.pageY);
                    setHoveredRowId((prev) =>
                      prev === target ? prev : target,
                    );
                  }
                : undefined
            }
            onDragEnd={
              canDrag
                ? (e: DragEvent) => {
                    const target = hitTest(e.pageX, e.pageY);
                    if (target && target !== row.id && onUpdateView) {
                      onUpdateView({ order: computeOrder(row.id, target) });
                    }
                    setDraggedRowId(null);
                    setHoveredRowId(null);
                    setPointerPos(null);
                  }
                : undefined
            }
          >
            <html.div
              ref={dropReg?.ref}
              style={[
                styles.listItem,
                viewportWidth <= TOUCH_VIEWPORT_MAX && styles.listItemTouch,
                i === rows.length - 1 && styles.listItemLast,
                canDrag && styles.draggableHandle,
                draggedRowId === row.id && styles.listItemDragging,
                isDropTarget && styles.listItemDropTarget,
              ]}
            >
              <html.span style={styles.listItemTitle}>
                {titleField ? formatValue(row[titleField]) : ""}
                {bodies?.[row.id] ? (
                  <BodyBadge onClick={onOpenBody ? () => onOpenBody(row.id) : undefined} />
                ) : null}
              </html.span>
              {secondaryFields.map((name) => (
                <html.span key={name} style={styles.listItemSecondary}>
                  <CellValue
                    field={fieldMap.get(name)}
                    value={row[name]}
                    relatedTables={relatedTables}
                    onOpenRelation={onOpenRelation}
                  />
                </html.span>
              ))}
            </html.div>
          </DragHandle>
        );
      })}
      {draggedRowId &&
        (() => {
          const row = rows.find((r) => r.id === draggedRowId);
          if (!row) return null;
          return (
            <DragGhost pointerPos={pointerPos}>
              <html.div style={styles.ghostListRow}>
                {titleField ? formatValue(row[titleField]) : row.id}
              </html.div>
            </DragGhost>
          );
        })()}
    </html.div>
  );
}

/**
 * Minimal calendar view — month grid. Anchors rows on their
 * `view.calendar_field` (date string). Days outside the current month
 * render dimmed. Prev / next month navigation; "today" highlight is
 * deferred for now.
 *
 * Date parsing: tolerant of `YYYY-MM-DD` strings (the .table format's
 * `date` type) and full ISO datetime strings (extracts the date
 * portion). Non-string / invalid values are skipped silently.
 *
 * Layout: 7 columns × 6 rows. Day cells use the same viewport-aware
 * `cellWidth` function-style as TableView, sized to `viewport / 7`
 * so the grid fills the available width.
 */
export function CalendarView({
  view,
  rows,
  schema,
  bodies,
  onOpenBody,
}: ViewProps) {
  const calField = view.calendar_field;
  const range = view.calendar_range;

  // Day cell tap opens a sheet listing that day's rows — Apple /
  // Google Calendar pattern. Cells themselves render just dots.
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  // Measure the calendar's own container — viewport width would be
  // wrong on web layouts with a sidebar (calendar's parent is the
  // main pane, narrower than the window). 7 columns means every cell
  // is `floor(containerWidth / 7)`; until the first layout pass
  // completes width is 0, so we guard with a tiny fallback that
  // doesn't visibly flash.
  const { measureProps, width: containerWidth } = useContainerWidth();
  const dayCellWidth =
    containerWidth > 0 ? Math.floor(containerWidth / 7) : 0;

  // Range bounds, normalised to first-of-month so we compare cursors
  // at the same granularity as `cursor` (which is always first-of-month).
  // Invalid dates in the range silently degrade to "no bound".
  const rangeStart = (() => {
    if (!range?.start) return null;
    const d = new Date(range.start.slice(0, 10));
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  })();
  const rangeEnd = (() => {
    if (!range?.end) return null;
    const d = new Date(range.end.slice(0, 10));
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  })();

  // Anchor the cursor on the earliest date in the data so the calendar
  // doesn't render an empty month when fixture dates are in the past
  // relative to "today". Then clamp into the range if set.
  const [cursor, setCursor] = useState(() => {
    let initial: Date;
    if (calField) {
      const earliest = rows
        .map((r) => r[calField])
        .filter((v): v is string => typeof v === "string" && v.length >= 10)
        .map((s) => new Date(s.slice(0, 10)))
        .filter((d) => !Number.isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (earliest) {
        initial = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
      } else {
        const now = new Date();
        initial = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    } else {
      const now = new Date();
      initial = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    // Clamp to range bounds.
    if (rangeStart && initial < rangeStart) initial = rangeStart;
    if (rangeEnd && initial > rangeEnd) initial = rangeEnd;
    return initial;
  });

  if (!calField) {
    return (
      <html.div style={styles.calendarEmpty}>
        <html.span>
          No `calendar_field` configured on this view.
        </html.span>
      </html.div>
    );
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthName = monthNameLong(cursor);
  // Locale-aware: weekday labels + first-day-of-week. Sunday-first in
  // US/CA/JP/etc., Monday-first across most of Europe + ISO, Saturday-
  // first in parts of the Middle East. `Intl.Locale.getWeekInfo()`
  // figures this out from the runtime's locale; falls back to Sunday.
  const weekStart = firstDayOfWeek();
  const orderedWeekdayNames = rotateWeekdays(weekdayNamesShort(), weekStart);
  const dayOfMonth1 = new Date(year, month, 1).getDay();
  const leadingBlanks = (dayOfMonth1 - weekStart + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // 6 weeks × 7 days = 42 cells. Fill leading + trailing with adjacent
  // months so the grid is always rectangular regardless of which day
  // of the week the 1st falls on (and regardless of the locale's first
  // day of the week).
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = leadingBlanks - 1; i >= 0; i--) {
    cells.push({
      date: new Date(year, month - 1, daysInPrevMonth - i),
      inMonth: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  let tail = 1;
  while (cells.length < 42) {
    cells.push({ date: new Date(year, month + 1, tail++), inMonth: false });
  }

  // Bucket rows by YYYY-MM-DD.
  const rowsByDate = new Map<string, Row[]>();
  for (const row of rows) {
    const value = row[calField];
    if (typeof value !== "string" || value.length < 10) continue;
    const key = value.slice(0, 10);
    if (!rowsByDate.has(key)) rowsByDate.set(key, []);
    rowsByDate.get(key)!.push(row);
  }

  const titleField = schema.fields[0]?.name;
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

  // Range-aware navigation. When prev/next would step outside the
  // bounds (if any), the button disables visually + functionally.
  const canGoPrev = !rangeStart || cursor > rangeStart;
  const canGoNext = !rangeEnd || cursor < rangeEnd;

  return (
    <html.div {...measureProps} style={styles.calendar}>
      <html.div style={styles.calendarHeader}>
        <html.button
          onClick={
            canGoPrev
              ? () => setCursor(new Date(year, month - 1, 1))
              : undefined
          }
          disabled={!canGoPrev}
          style={[styles.calendarNav, !canGoPrev && styles.calendarNavDisabled]}
        >
          ‹
        </html.button>
        <html.span style={styles.calendarTitle}>
          {monthName} {year}
        </html.span>
        <html.button
          onClick={
            canGoNext
              ? () => setCursor(new Date(year, month + 1, 1))
              : undefined
          }
          disabled={!canGoNext}
          style={[styles.calendarNav, !canGoNext && styles.calendarNavDisabled]}
        >
          ›
        </html.button>
      </html.div>
      <html.div style={styles.calendarWeekdays}>
        {orderedWeekdayNames.map((d, i) => (
          <html.span
            // Use index as key — `d` (the localized name) can theoretically
            // duplicate across exotic locales / ICU configurations, and we
            // always render exactly 7 in stable order.
            key={i}
            style={[styles.calendarWeekday, styles.cellWidth(dayCellWidth)]}
          >
            {d}
          </html.span>
        ))}
      </html.div>
      <html.div style={styles.calendarGrid}>
        {cells.map((cell, i) => {
          const key = dateKey(cell.date);
          const dayRows = rowsByDate.get(key) ?? [];
          const dotsToShow = Math.min(dayRows.length, 3);
          const overflowCount = dayRows.length - dotsToShow;
          return (
            <html.button
              key={i}
              onClick={() => setSelectedDateKey(key)}
              style={[
                styles.calendarDay,
                styles.calendarDayButton,
                styles.cellWidth(dayCellWidth),
                !cell.inMonth && styles.calendarDayOther,
              ]}
            >
              <html.span style={styles.calendarDayNum}>
                {cell.date.getDate()}
              </html.span>
              {dayRows.length > 0 && (
                <html.div style={styles.calendarDayDots}>
                  {Array.from({ length: dotsToShow }).map((_, j) => (
                    <html.span key={j} style={styles.calendarDayDot} />
                  ))}
                  {overflowCount > 0 && (
                    <html.span style={styles.calendarDayMore}>
                      +{overflowCount}
                    </html.span>
                  )}
                </html.div>
              )}
            </html.button>
          );
        })}
      </html.div>
      {(() => {
        // Day-detail sheet — renders the selected day's rows as a
        // tappable list. Tap-through opens the row's body if it has
        // one (same affordance as the calendar row chips had).
        const dayRows = selectedDateKey
          ? rowsByDate.get(selectedDateKey) ?? []
          : [];
        const sheetTitle = selectedDateKey
          ? new Date(selectedDateKey).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : "";
        return (
          <BottomSheet
            visible={selectedDateKey !== null}
            onDismiss={() => setSelectedDateKey(null)}
            title={sheetTitle}
          >
            {dayRows.length === 0 ? (
              <html.span style={styles.daySheetEmpty}>
                No items on this day.
              </html.span>
            ) : (
              dayRows.map((row) => {
                const label = titleField
                  ? formatValue(row[titleField])
                  : row.id;
                const hasBody = !!bodies?.[row.id];
                return (
                  <html.button
                    key={row.id}
                    onClick={() => {
                      setSelectedDateKey(null);
                      if (hasBody && onOpenBody) onOpenBody(row.id);
                    }}
                    style={styles.daySheetItem}
                  >
                    {label}
                  </html.button>
                );
              })
            )}
          </BottomSheet>
        );
      })()}
    </html.div>
  );
}

interface CardProps {
  row: Row;
  fields: string[];
  fieldMap: Map<string, Field>;
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
}

function Card({ row, fields, fieldMap, relatedTables, onOpenRelation }: CardProps) {
  const titleField = fields[0];
  const restFields = fields.slice(1);
  return (
    <html.div style={styles.card}>
      {titleField && (
        <html.span style={styles.cardTitle}>{formatValue(row[titleField])}</html.span>
      )}
      <CardBody
        row={row}
        fields={restFields}
        fieldMap={fieldMap}
        relatedTables={relatedTables}
        onOpenRelation={onOpenRelation}
        hideTitle
      />
    </html.div>
  );
}

function CardBody({
  row,
  fields,
  fieldMap,
  relatedTables,
  onOpenRelation,
}: CardProps & { hideTitle?: boolean }) {
  return (
    <>
      {fields.map((name) => (
        <html.div key={name} style={styles.cardField}>
          <html.span style={styles.cardFieldLabel}>{name}</html.span>
          <html.span style={styles.cardFieldValue}>
            <CellValue
              field={fieldMap.get(name)}
              value={row[name]}
              relatedTables={relatedTables}
              onOpenRelation={onOpenRelation}
            />
          </html.span>
        </html.div>
      ))}
    </>
  );
}
