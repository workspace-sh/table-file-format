import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { focusInput } from "./focusInput";
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";
import { Portal } from "./internal/Portal";
import {
  bodyExcerpt,
  describeCell,
  fieldsByName,
  fittedRowHeight,
  formatValue,
  DEFAULT_ROW_HEIGHT,
  groupLabel,
  groupedRows,
  shownTotal,
  pillFor,
  type Pill,
  type RelationLink,
  linesFor,
  columnWidths,
  resizedColumnWidth,
  rowHeightOf,
  snappedRowHeight,
  MIN_RESIZED_COLUMN_WIDTH,
  ROW_NUMBER_WIDTH,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  TOTAL_LABELS,
  TOTAL_NAMES,
  totalFor,
  visibleFields,
  pillColors,
  EMPTY_TEXT,
} from "./display";
import type { ViewProps } from "./viewProps";
import { commitDraft, currencySymbolOf, draftOf, editorKind, inputKind, listFromText, listItems, listText, listToggled, relatesMany, relationOptions, relationToggled } from "./cellEdit";
import { explainFormula, formulaDraftOf, formulaInputCells, viewGrid } from "./formulaCell";
import { useCellEditor, type CellEditSession } from "./cellEditor";
import {
  BOARD_GAP,
  boardColumns,
  boardCardMove,
  canStep,
  cardFields,
  CALENDAR_CHIPS_PER_DAY,
  columnOf,
  columnValue,
  dateKey,
  galleryLayout,
  initialMonth,
  localDay,
  monthGrid,
  orderAfterDrop,
  orderMovedTo,
  orderSwapped,
  rowsByDay,
  rowTitle,
  columnLabel,
} from "./cards";
import type { CellCheck } from "./cellCheck";
import { useDirection, useDisplaySettings } from "./DisplaySettings";
import { useHaptics } from "./Haptics";
import { fieldHint, fieldHintText } from "./fieldHintFacts";
import { FieldHint, Hinted } from "./FieldHint";
import { isImageFile, useAttachmentUrl } from "./Attachments";
import { AttachmentImage } from "./internal/AttachmentImage";
import {
  applyGroup,
  completeSeconds,
  effectiveAlign,
  enumOptions,
  columnLetter,
  computeRows,
  coordinateOf,
  formatValue as formatCellValue,
  memoryViewRows,
} from "@workspace.sh/table-core";
import { rowLayout, type RowMark } from "./rowLayout";
import { useViewFacts, useViewWindow } from "./useViewRows";
import type {
  SheetRef,
  ViewTotal,
  Field,
  FieldAlignment,
  ParsedTable,
  Row,
  TableSchema,
  View,
} from "@workspace.sh/table-core";
import {
  AddFieldButton,
  FormulaCellPanel,
  SchemaFieldEditor,
} from "./SchemaEditor";
import { measureAnchor, type AnchorRect } from "./internal/measureAnchor";
import { useContainerWidth } from "./internal/useContainerWidth";
import { useDropTargets } from "./internal/useDropTargets";
import { DragHandle, type DragEvent } from "./internal/DragHandle";
import { HScroll } from "./internal/HScroll";
import { SnapHScroll } from "./internal/SnapHScroll";
import { HOVERS } from "./internal/hovers";
import { GridKeys, type GridKeysHandle } from "./internal/GridKeys";
import { Bleed, GutterSpacer } from "./internal/Bleed";
import { useViewportWidth } from "./internal/useViewportWidth";
import { Platform } from "react-native";
import { PageReveal } from "./pageReveal";
import { Select, Toggle } from "./PlatformControls";
import { moveInColumns, moveInGrid, nudge } from "./cardNav";
import { afterEdit, cellPicks, gridKey } from "./gridNav";
import { BottomSheet } from "./internal/BottomSheet";
import {
  firstDayOfWeek,
  monthNameLong,
  rotateWeekdays,
  weekdayNamesShort,
} from "./internal/calendarLocale";
import { rowNumber } from "./sheets";
import { adoptSystemColors } from "./internal/systemColors";
import { CellLink } from "./internal/CellLink";
import { inputHints, type InputHintKind } from "./inputHints";
import { applyKeyboard, cellInputFit, inputAttributes } from "./internal/inputAttributes";
import { usePlatformControls } from "./PlatformControls";
import { rowActions } from "./controlSlots";
import { MAX_LIST_HEIGHT } from "./internal/listLimits";
import { SPAN_GAP } from "./internal/spanGap";
import { RowList, type RowListHandle } from "./internal/RowList";

/**
 * Minimum readable column width. On narrow viewports (mobile portrait)
 * every cell renders at this exact width and the table extends past the
 * viewport → horizontal scroll. On wide viewports (macOS / web) we
 * compute `Math.max(MIN_CELL_WIDTH, viewport / ncols)` so columns fill
 * the available width Airtable-style instead of leaving empty space.
 */
const MIN_CELL_WIDTH = 180; // MIN_CELL_WIDTH in display.ts, restated for StyleX

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

// CELL_LINE_HEIGHT in display.ts, which linesFor divides by. Restated here
// because StyleX compiles css.create from values in this file only.
const CELL_LINE_HEIGHT = 20;

/**
 * Whether the browser's window size can be read, to keep a popover on
 * screen. React Native has a `window` (its global) without innerWidth, so
 * a popover there keeps its unclamped position rather than NaN.
 */
function hasWindowSize(): boolean {
  return typeof window !== "undefined" && typeof window.innerWidth === "number";
}

/** A group's heading band, above its first row (the row list adds it, with its border, to that row's height). */
const GROUP_ROW_HEIGHT = 32;
/** The line under each row (tableRow's borderBottomWidth). */
const ROW_BORDER = 1;

const styles = css.create({
  // Table
  tableWithAdd: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    // The selected cell shows where the keyboard is; no ring round it all.
    outlineStyle: "none",
  },
  /** A card with the keyboard: the same blue as a selected cell. */
  cardFocused: {
    borderRadius: 10,
    boxShadow: "0 0 0 2px #0a84ff",
  },
  /** A list row with the keyboard: inset, as rows sit edge to edge. */
  listItemFocused: {
    boxShadow: "inset 0 0 0 2px #0a84ff",
  },
  /** The selected cell: an inset ring, inside the cell's own borders. */
  cellSelected: {
    boxShadow: "inset 0 0 0 2px #0a84ff",
  },
  tableGrow: {
    flex: 1,
    minWidth: 0,
  },
  // Edge to edge: the frame is as wide as its columns, inside the
  // sideways scroller, rather than the scroller inside the frame.
  tableFit: {
    flexShrink: 0,
  },
  // Edge to edge, the panes are as wide and tall as their rows: flex: 1
  // would start them from nothing inside a scroller sized by its content.
  tablePaneFit: {
    display: "flex",
    flexDirection: "column",
  },
  bleedRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
  },
  // What the columns share when the frame scrolls: the page's width.
  // Measured on a line with no height.
  measureRow: {
    height: 0,
    overflow: "hidden",
  },
  /** "+ Field" under an edge-to-edge grid. */
  addFieldBelow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 8,
  },
  /** Centres the "+" on the header row (33px). */
  addFieldSlot: {
    display: "flex",
    alignItems: "center",
    height: 35,
  },
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
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  // The pane beside the frozen column. A flex item grows to fit its
  // content unless told it may shrink; without minWidth 0 it takes the
  // whole table's width, HScroll inside it never overflows, and the
  // table's rounded overflow: hidden cuts the far columns off.
  tableScrollOuter: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
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
  rowHeight: (h: number) => ({
    height: h,
  }),
  positioned: {
    position: "relative",
  },
  // A line of no height under the selected row, outside its row-actions
  // wrapper, that the grip hangs from. On iOS that wrapper is a native
  // context-menu view, which takes no touch outside its bounds, so a grip
  // inside the row couldn't be touched below the row's edge.
  rowGripAnchor: {
    position: "relative",
    height: 0,
    zIndex: 3,
  },
  // A selected row's grip, straddling its bottom edge under the selected
  // cell (rowGripAt).
  rowGripAt: (x: number) => ({
    insetInlineStart: x,
  }),
  rowGripSlot: {
    position: "absolute",
    bottom: -17,
    zIndex: 3,
  },
  // Room for a finger around the pill: 52 by 34, centred on the row's edge.
  rowGripHit: {
    paddingBlock: 10,
    paddingInline: 12,
    cursor: "row-resize",
  },
  rowGrip: {
    width: 28,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#0a84ff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  rowGripBar: {
    width: 12,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "#ffffff",
  },
  // Beside the pill, out of the flow, so the pill stays put as it appears.
  rowGripLabel: {
    position: "absolute",
    bottom: 5,
    insetInlineStart: "100%",
    whiteSpace: "nowrap",
    fontSize: 11,
    fontWeight: 600,
    color: "#ffffff",
    backgroundColor: "#0a84ff",
    borderRadius: 6,
    paddingInline: 6,
    paddingBlock: 2,
  },
  /** A value that can't wrap: one line, cut short with an ellipsis. */
  oneLine: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    lineHeight: `${CELL_LINE_HEIGHT}px`,
  },
  /** Cell text shows only the lines its row has room for. */
  // lineClamp becomes numberOfLines on native (with an ellipsis); on
  // web it doesn't take effect, so maxHeight stops the text at the last
  // whole line instead.
  clamp: (n: number) => ({
    lineClamp: n,
    overflow: "hidden",
    minWidth: 0,
    lineHeight: `${CELL_LINE_HEIGHT}px`,
    maxHeight: n * CELL_LINE_HEIGHT,
  }),
  tableRow: {
    display: "flex",
    flexDirection: "row",
    borderBottomWidth: ROW_BORDER,
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
    // Base text color for cell content. RN's Text inherits color from
    // a parent Text (which `html.span` renders to on native), so the
    // unstyled value span inside CellValue picks this up. Without it,
    // RSD falls back to a static "black" default that doesn't adapt to
    // appearance and renders invisibly on dark backgrounds.
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    // An inset ring when the cell contains a focused descendant (i.e. the
    // input is open). Indicator lives on the cell, not on the input, so
    // the input itself can stay layout-neutral and the text doesn't shift
    // on edit-mode swap. :focus-within is CSS-only — RN port via the same
    // useFocused hook pattern documented in strict.css.
    ":focus-within": {
      // The same ring as a selected cell: editing is the selected cell
      // with a caret in it, as in Sheets.
      boxShadow: "inset 0 0 0 2px #0a84ff",
    },
  },
  tableCellAlignCenter: {
    justifyContent: "center",
    textAlign: "center",
  },
  tableCellAlignEnd: {
    justifyContent: "flex-end",
    textAlign: "end",
  },
  /** A formula cell can be clicked to see how it was worked out. */
  formulaCellClickable: {
    cursor: "pointer",
  },
  /** The column a formula belongs to, while one of its cells is open. */
  formulaColumnTint: {
    backgroundColor: {
      default: "rgba(10, 132, 255, 0.06)",
      "@media (prefers-color-scheme: dark)": "rgba(10, 132, 255, 0.10)",
    },
  },
  /** The cell that was opened. */
  formulaCellActive: {
    boxShadow: "inset 0 0 0 2px #0a84ff",
  },
  /** A cell the open formula reads, in the same row. */
  formulaInputCell: {
    boxShadow: "inset 0 0 0 1px rgba(10, 132, 255, 0.7)",
    backgroundColor: {
      default: "rgba(10, 132, 255, 0.10)",
      "@media (prefers-color-scheme: dark)": "rgba(10, 132, 255, 0.16)",
    },
  },
  tableCellSeparator: {
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  tableHeaderCell: {
    // One line, always: a header that wraps is taller than the frozen
    // pane's, and every row below it then sits out of line.
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
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
    // The width includes the padding and border, so a column is as wide
    // as the snap step expects and the next one peeks. Measured on iOS,
    // content-box made each column 28pt wider: the next never showed, and
    // each swipe landed further off its column.
    boxSizing: "border-box",
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
  // Board drop position: a line above or below the card under the pointer.
  dropBefore: {
    boxShadow: "0 -3px 0 0 #3478f6",
  },
  dropAfter: {
    boxShadow: "0 3px 0 0 #3478f6",
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
    marginInlineStart: 6,
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
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    flex: 1,
    minWidth: 0,
  },
  listItemTitleText: {
    fontSize: 13,
    fontWeight: "500",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  // A title and its "doc" badge side by side, wrapping as the title would.
  titleWithBadge: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
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
    // Width applied at use-site via the `dayColWidth(colIndex)` helper.
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
    // Same `dayColWidth(n)` applied at use-site as the header cells,
    // so headers and grid share identical column geometry.
    flexShrink: 0,
    flexGrow: 0,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minHeight: 80,
    paddingInline: 4,
    paddingBlock: 4,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: {
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
  calendarDayToday: {
    alignSelf: "flex-start",
    paddingInline: 6,
    borderRadius: 999,
    color: "#ffffff",
    backgroundColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  calendarChips: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginTop: 4,
    minWidth: 0,
  },
  calendarChip: {
    fontSize: 11,
    lineHeight: "16px",
    maxHeight: 16,
    lineClamp: 1,
    overflow: "hidden",
    paddingInline: 5,
    borderRadius: 4,
    cursor: "pointer",
    color: {
      default: "#1d4ed8",
      "@media (prefers-color-scheme: dark)": "#93c5fd",
    },
    backgroundColor: {
      default: "#e8f0fe",
      ":hover": "#d2e3fc",
      "@media (prefers-color-scheme: dark)": "#1e2a44",
    },
  },
  calendarChipMore: {
    fontSize: 10,
    paddingInline: 5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
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
    textAlign: "start",
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
    textAlign: "start",
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
    borderInlineStartWidth: 0,
    borderInlineEndWidth: 0,
    borderBottomWidth: 0,
    cursor: "pointer",
    textAlign: "start",
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
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
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
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },

  // Pill (for enum values)
  pillAtStart: { alignSelf: "flex-start" },
  /** A footer cell inside a menu button: fills the row's height, as the others do. */
  totalCellFill: {
    alignSelf: "stretch",
  },
  /** Pills cut to one line, with a "+N" for the rest. */
  pillListOneLine: {
    flexWrap: "nowrap",
    overflow: "hidden",
  },
  pillMore: {
    flexShrink: 0,
  },
  pill: {
    paddingInline: 10,
    paddingBlock: 3,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "500",
  },

  // The totals footer.
  totalsRow: {
    height: 36,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#26262b" },
    backgroundColor: { default: "#fafafa", "@media (prefers-color-scheme: dark)": "#111114" },
  },
  totalsRowQuiet: {
    height: 32,
    borderTopWidth: 0,
    backgroundColor: "transparent",
  },
  newRow: {
    display: "flex",
    height: 36,
    // On the band, not the label: native drops a text span's inline padding.
    paddingInline: 16,
    alignItems: "center",
    cursor: "pointer",
  },
  newRowHot: {
    backgroundColor: { default: "#f5f5f7", "@media (prefers-color-scheme: dark)": "#17171a" },
  },
  newRowLabel: {
    fontSize: 13,
    whiteSpace: "nowrap",
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
  },
  totalCell: {
    display: "flex",
    // Fits the 36px totals row. A cell's usual minimum of 40 hung below
    // it, and in the scrolling pane that overhang could be scrolled.
    minHeight: 0,
    paddingBlock: 0,
    gap: 6,
    cursor: "pointer",
    alignItems: "center",
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
  },
  shown: {
    opacity: 1,
  },
  totalPlaceholder: {
    fontSize: 11,
    // Shown on hover, or all along where nothing hovers (a touch screen):
    // otherwise the footer is a blank strip there.
    opacity: { default: 0, ":hover": 1, "@media (hover: none)": 1 },
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
  },
  // A grouped table's band at the start of each group (fixed height, so
  // the frozen and scrolling panes stay in line).
  groupRow: {
    display: "flex",
    height: GROUP_ROW_HEIGHT,
    alignItems: "center",
    paddingInline: 16,
    backgroundColor: { default: "#f5f5f7", "@media (prefers-color-scheme: dark)": "#141417" },
  },
  groupLabel: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  listGroup: {
    paddingInline: 4,
    paddingTop: 14,
    paddingBottom: 6,
  },
  groupCount: {
    fontWeight: "400",
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
  },
  // A sheet's row numbers and column letters (`coordinates`, D34).
  rowNumber: {
    width: 32,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingInline: 6,
    boxSizing: "border-box",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#26262b" },
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
    backgroundColor: { default: "#fafafa", "@media (prefers-color-scheme: dark)": "#111114" },
  },
  rowNumberCorner: {
    alignSelf: "stretch",
  },
  columnLetter: {
    marginInlineEnd: 6,
    fontSize: 10,
    fontWeight: "600",
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
  },
  // On native the letter stacks above the name instead of sitting before it: without the gap, so the two share an edge.
  columnLetterStacked: {
    marginInlineEnd: 0,
  },
  // The 14 symbolic enum colours (SPEC section 2, DECISIONS D43), mapped onto light and dark.
  pillGray: { backgroundColor: { default: "#e8e8ed", "@media (prefers-color-scheme: dark)": "#2c2c31" }, color: { default: "#3a3a3c", "@media (prefers-color-scheme: dark)": "#e5e5ea" } },
  pillBrown: { backgroundColor: { default: "#eee3d8", "@media (prefers-color-scheme: dark)": "#3b2a1d" }, color: { default: "#7a4a21", "@media (prefers-color-scheme: dark)": "#d9b08c" } },
  pillRed: { backgroundColor: { default: "#fde2e1", "@media (prefers-color-scheme: dark)": "#4a1f1f" }, color: { default: "#b42318", "@media (prefers-color-scheme: dark)": "#ff8a80" } },
  pillOrange: { backgroundColor: { default: "#fde8d4", "@media (prefers-color-scheme: dark)": "#4a2c14" }, color: { default: "#b54708", "@media (prefers-color-scheme: dark)": "#ffb86b" } },
  pillYellow: { backgroundColor: { default: "#fdf3c4", "@media (prefers-color-scheme: dark)": "#433a10" }, color: { default: "#7a5f00", "@media (prefers-color-scheme: dark)": "#f5d565" } },
  pillLime: { backgroundColor: { default: "#eaf5cc", "@media (prefers-color-scheme: dark)": "#2b3a10" }, color: { default: "#4d6b00", "@media (prefers-color-scheme: dark)": "#c3e56a" } },
  pillGreen: { backgroundColor: { default: "#dcf5e3", "@media (prefers-color-scheme: dark)": "#16341f" }, color: { default: "#1f7a2c", "@media (prefers-color-scheme: dark)": "#7ee08a" } },
  pillMint: { backgroundColor: { default: "#d8f5ea", "@media (prefers-color-scheme: dark)": "#12362b" }, color: { default: "#0b6b4d", "@media (prefers-color-scheme: dark)": "#7fe3c0" } },
  pillTeal: { backgroundColor: { default: "#d4f1f2", "@media (prefers-color-scheme: dark)": "#10353a" }, color: { default: "#0e6b73", "@media (prefers-color-scheme: dark)": "#76dde6" } },
  pillCyan: { backgroundColor: { default: "#d6eefb", "@media (prefers-color-scheme: dark)": "#0f3447" }, color: { default: "#075985", "@media (prefers-color-scheme: dark)": "#7cd3f7" } },
  pillBlue: { backgroundColor: { default: "#dde9fd", "@media (prefers-color-scheme: dark)": "#15284a" }, color: { default: "#1d4ed8", "@media (prefers-color-scheme: dark)": "#8ab4ff" } },
  pillIndigo: { backgroundColor: { default: "#e1e4fb", "@media (prefers-color-scheme: dark)": "#1f2347" }, color: { default: "#4338ca", "@media (prefers-color-scheme: dark)": "#a5adff" } },
  pillPurple: { backgroundColor: { default: "#ece3fd", "@media (prefers-color-scheme: dark)": "#2d1f4a" }, color: { default: "#6d28d9", "@media (prefers-color-scheme: dark)": "#c4a8ff" } },
  pillPink: { backgroundColor: { default: "#fce1f0", "@media (prefers-color-scheme: dark)": "#4a1f36" }, color: { default: "#be185d", "@media (prefers-color-scheme: dark)": "#ff9ecb" } },
  pillList: { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 4 },
  choiceItem: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 },
  choiceCheck: { width: 12, fontSize: 12 },
  relationList: { display: "flex", flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 2 },
  link: {
    textDecorationLine: "underline",
    textDecorationColor: { default: "rgba(0,0,0,0.25)", "@media (prefers-color-scheme: dark)": "rgba(255,255,255,0.3)" },
    color: { default: "#1d4ed8", "@media (prefers-color-scheme: dark)": "#8ab4ff" },
  },
  attachment: { display: "flex", flexDirection: "row", alignItems: "center", gap: 6 },
  attachmentThumb: { width: 20, height: 20, borderRadius: 4, objectFit: "cover" },
  galleryImage: { width: "100%", height: 120, objectFit: "contain", borderRadius: 6, marginBottom: 6 },

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
    textAlign: "start",
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
  /** A computed field whose formula failed (#DIV/0!, #VALUE!, …). */
  formulaError: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: {
      default: "#c00",
      "@media (prefers-color-scheme: dark)": "#ff6b6b",
    },
  },
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
    // As tableCell: the separator is inside the column's width. Without
    // this each header is 1px wider than its cells, and the drift adds up
    // across the row.
    boxSizing: "border-box",
  },
  headerCellButton: {
    flex: 1,
    minWidth: 0,
    // One line, as tableHeaderCell: the full title is in the hover hint.
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    paddingBlock: 10,
    paddingInline: 16,
    backgroundColor: "transparent",
    borderWidth: 0,
    textAlign: "start",
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
  headerCellButtonEnd: {
    textAlign: "end",
  },
  headerCellDeprecated: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },

  // Editable-cell input — layout-identical to the idle wrapper
  // (cellEditableIdle) so swapping between display and edit doesn't shift
  // anything by even a pixel. Zero padding, zero border, transparent.
  // The focus indicator is on the parent tableCell via :focus-within.
  // A cell whose draft wasn't saved (D42): the reason, just under it.
  cellProblem: {
    position: "fixed",
    zIndex: 1000,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "max-content",
    maxWidth: 320,
    paddingInline: 10,
    paddingBlock: 6,
    borderRadius: 8,
    fontSize: 12,
    lineHeight: 1.35,
    whiteSpace: "normal",
    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
  },
  cellProblemAt: (top: number, left: number) => ({ top, left }),
  /** Long text being written: a box over its cell, at least as wide, growing with its lines. */
  cellLongText: {
    position: "fixed",
    zIndex: 60,
    minHeight: 120,
    maxHeight: "50vh",
    paddingInline: 10,
    paddingBlock: 8,
    fontSize: 13,
    lineHeight: 1.45,
    fontFamily: "inherit",
    resize: "none",
    boxSizing: "border-box",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: { default: "#3478f6", "@media (prefers-color-scheme: dark)": "#0a84ff" },
    borderRadius: 6,
    outlineStyle: "none",
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1e" },
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
  },
  cellLongTextAt: (top: number, left: number, width: number) => ({ top, left, width }),
  cellProblemRefused: {
    color: "#ffffff",
    backgroundColor: { default: "#c62828", "@media (prefers-color-scheme: dark)": "#b3261e" },
  },
  cellProblemAsk: {
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
    backgroundColor: { default: "#fff4d6", "@media (prefers-color-scheme: dark)": "#3a3120" },
  },
  cellProblemFix: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "600",
    paddingInline: 8,
    paddingBlock: 3,
    borderRadius: 6,
    borderWidth: 0,
    cursor: "pointer",
    color: "#ffffff",
    backgroundColor: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" },
  },
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
  /** A value being typed in an editor outside the cell (#352), shown as it is typed. */
  cellOutsideDraft: {
    fontSize: 14,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: { default: "#1d1d1f", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  cellEditableIdle: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    width: "100%",
    // May be narrower than its value, so a long one is cut short, not
    // pushed out of the cell.
    minWidth: 0,
    minHeight: 22,
    cursor: "text",
  },

  // Spacer in body rows to mirror the "+ Field" header column slot.
  // Width must match SchemaEditor's `addFieldWrapper.width` — kept as a
  // literal here because StyleX is static-extraction-only and can't
  // resolve cross-module constants inside css.create().
  cellInputAffixed: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: "100%",
  },
  cellInputAffix: {
    fontSize: 12,
    flexShrink: 0,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  noRightBorder: {
    borderInlineEndWidth: 0,
  },
  noBottomBorder: {
    borderBottomWidth: 0,
  },
  // The totals footer's menu (the row menu is RowActions').
  rowMenuBackdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 49,
    backgroundColor: "transparent",
  },
  rowMenu: {
    position: "fixed",
    zIndex: 50,
    minWidth: 180,
    paddingBlock: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
    borderColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#2c2c31" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1f" },
  },
  rowMenuAt: (top: number, left: number) => ({ top, left }),
  rowMenuItem: {
    textAlign: "start",
    paddingInline: 12,
    paddingBlock: 6,
    fontSize: 13,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#2a2a2e" },
    },
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },

  // "doc" badge for rows with a markdown body — clickable variant overrides
  // Beside a 13px title, where it sat when it was inline: 3px down, and
  // no taller than the title's line, so the row keeps its height.
  bodyBadgeBesideTitle: {
    marginTop: 3,
    marginBottom: -0.5,
  },
  bodyBadgeHintBesideTitle: {
    marginInlineStart: 6,
    marginTop: 3,
    marginBottom: -0.5,
  },
  bodyBadgeButtonBesideTitle: {
    marginInlineStart: 0,
  },
  bodyBadgeButton: {
    borderWidth: 0,
    cursor: "pointer",
  },
  bodyBadge: {
    // Its own width, its text centred: on native a button is a box that otherwise keeps its text at the start.
    display: "flex",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    paddingInline: 6,
    paddingBlock: 1,
    marginInlineStart: 6,
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
    borderInlineStartWidth: 0,
    borderInlineEndWidth: 0,
    borderBottomWidth: 0,
    cursor: "pointer",
    textAlign: "start",
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
// On iOS, the interface's colours become the system's (internal/systemColors).
adoptSystemColors(styles);

/**
 * Fields by name, each carrying the format it is shown with. A formula
 * with no format of its own shows its inputs' currency (D33): a formula
 * over dollars is shown in dollars, never silently relabelled.
 */

function cellAlignStyle(align: FieldAlignment) {
  if (align === "center") return styles.tableCellAlignCenter;
  if (align === "end") return styles.tableCellAlignEnd;
  return false as const;
}

function headerAlignStyle(align: FieldAlignment) {
  if (align === "center") return styles.headerCellButtonCenter;
  if (align === "end") return styles.headerCellButtonEnd;
  return false as const;
}




/** The width a table cell's content has, for pills to know how many fit. */
const CellWidth = createContext<number | undefined>(undefined);

/** A pill's width, roughly: its label, padding and the gap after it. */
const pillWidth = (p: Pill) => String(p.label).length * 7.6 + 30;
/** The pills that fit in `width`, leaving room for a "+N" when some don't. */
function pillsThatFit(pills: Pill[], width: number): Pill[] {
  let used = 0;
  const out: Pill[] = [];
  for (let i = 0; i < pills.length; i++) {
    const w = pillWidth(pills[i]!);
    const reserve = i < pills.length - 1 ? 40 : 0;
    if (out.length > 0 && used + w + reserve > width) break;
    out.push(pills[i]!);
    used += w;
  }
  return out;
}

interface CellValueProps {
  field: Field | undefined;
  value: unknown;
  /** Loaded sibling tables, for resolving relation cells. */
  relatedTables?: Record<string, ParsedTable>;
  /** Called with a row address when a relation cell is clicked. */
  onOpenRelation?: (address: string) => void;
  /** In a grid: the lines of text the row has room for; the rest is clipped. */
  lines?: number;
  /**
   * Shown in a column (a card's value), not a table row: a lone chip keeps
   * its own width at the start instead of stretching across, as a native
   * column stretches its children. On the web it's inline there already.
   */
  inColumn?: boolean;
}

function CellValue({ field, value, relatedTables, onOpenRelation, lines, inColumn }: CellValueProps) {
  const clamp = lines !== undefined ? styles.clamp(lines) : undefined;
  const width = useContext(CellWidth);
  const display = useDisplaySettings();
  const shown = describeCell(field, value, display, relatedTables);
  switch (shown.kind) {
    case "relations":
      // One related row reads as itself; many sit in a row of links.
      if (!Array.isArray(value)) return <RelationCellValue link={shown.links[0]!} onOpenRelation={onOpenRelation} />;
      return (
        <html.div style={styles.relationList}>
          {shown.links.map((link) => (
            <RelationCellValue key={link.id} link={link} onOpenRelation={onOpenRelation} />
          ))}
        </html.div>
      );
    case "error":
      return <html.span style={styles.formulaError}>{shown.code}</html.span>;
    case "pills": {
      // A single choice is its pill; a list sits in a row of them.
      if (!Array.isArray(value)) return <EnumPill pill={shown.pills[0]!} atStart={inColumn} />;
      // On one line in a table, as many as fit and then "+3".
      const shownPills = width !== undefined && (lines ?? 1) <= 1 ? pillsThatFit(shown.pills, width) : shown.pills;
      const more = shown.pills.length - shownPills.length;
      return (
        <html.div style={[styles.pillList, more > 0 && styles.pillListOneLine]}>
          {shownPills.map((pill, i) => (
            <EnumPill key={`${i}\u0000${String(pill.value)}`} pill={pill} />
          ))}
          {more > 0 ? (
            <html.span aria-label={`${more} more`} style={[styles.pill, styles.pillGray, styles.pillMore]}>
              +{more}
            </html.span>
          ) : null}
        </html.div>
      );
    }
    case "attachment":
      return <AttachmentValue fileName={shown.fileName} />;
    case "link":
      // A link the pointer clicks; on a touch screen, text with a button
      // that opens it, so a tap on the cell still selects it (CellLink).
      return (
        <CellLink href={shown.href} external={shown.external} label={linkLabel(shown.href, shown.text)} style={[styles.link, clamp]}>
          {shown.text}
        </CellLink>
      );
    case "text": {
      // An empty list is its dash, clamped like any text.
      if (Array.isArray(value)) return <html.span style={clamp}>{shown.text}</html.span>;
      const textStyle = shown.oneToken && lines !== undefined ? styles.oneLine : clamp;
      // Each value reads in its own direction (D40): a Hebrew name in an
      // English table, or an English one in an Arabic table.
      return <html.span dir="auto" style={textStyle}>{shown.text}</html.span>;
    }
  }
}

const PILL_COLORS = {
  gray: styles.pillGray,
  brown: styles.pillBrown,
  red: styles.pillRed,
  orange: styles.pillOrange,
  yellow: styles.pillYellow,
  lime: styles.pillLime,
  green: styles.pillGreen,
  mint: styles.pillMint,
  teal: styles.pillTeal,
  cyan: styles.pillCyan,
  blue: styles.pillBlue,
  indigo: styles.pillIndigo,
  purple: styles.pillPurple,
  pink: styles.pillPink,
} as const;

/** What opening a link does, for assistive technology: "Email a@b.c", "Call +44…", "Open example.com". */
function linkLabel(href: string, text: string): string {
  if (href.startsWith("mailto:")) return `Email ${text}`;
  if (href.startsWith("tel:")) return `Call ${text}`;
  return `Open ${text}`;
}

/** A choice as the schema describes it: its label, in its colour. */
function EnumPill({ pill, atStart }: { pill: Pill; atStart?: boolean }) {
  // No colour, or a name this reader doesn't know, is gray (SPEC section 4).
  const color = pill.color && Object.hasOwn(PILL_COLORS, pill.color) ? PILL_COLORS[pill.color as keyof typeof PILL_COLORS] : styles.pillGray;
  return <html.span style={[styles.pill, color, atStart && styles.pillAtStart]}>{pill.label}</html.span>;
}

/** A board column's heading: the choice's label when it has one. */
function BoardColumnTitle({ field, value }: { field: Field | undefined; value: string }) {
  return <html.span>{columnLabel(field, value)}</html.span>;
}

function AttachmentValue({ fileName }: { fileName: string }) {
  const url = useAttachmentUrl()(fileName);
  if (!url) return <html.span>{fileName}</html.span>;
  return (
    <html.span style={styles.attachment}>
      {isImageFile(fileName) ? <AttachmentImage src={url} name={fileName} fit="cover" style={styles.attachmentThumb} /> : null}
      <CellLink href={url} external label={`Open ${fileName}`} style={styles.link}>
        {fileName}
      </CellLink>
    </html.span>
  );
}

/** A gallery card's lead: the image itself when it's an attachment that resolves. */
function GalleryHero({ field, value }: { field: Field | undefined; value: unknown }) {
  const url = useAttachmentUrl()(typeof value === "string" ? value : "");
  if (field?.attachment && typeof value === "string" && url && isImageFile(value)) {
    return <AttachmentImage src={url} name={value} fit="contain" style={styles.galleryImage} />;
  }
  return <html.span dir="auto" style={styles.galleryCardHero}>{formatValue(value)}</html.span>;
}

function RelationCellValue({
  link,
  onOpenRelation,
}: {
  link: RelationLink;
  onOpenRelation?: (address: string) => void;
}) {
  if (link.label === null) {
    // Dangling — no related table loaded, OR table loaded but row not
    // in it. Render visibly rather than silently.
    return (
      <html.span style={styles.relationBroken} aria-label={`Dangling: ${link.address}`}>
        {link.id}
      </html.span>
    );
  }

  if (!onOpenRelation) {
    // Resolvable but no navigation callback wired up — render the label
    // as plain text (read-only consumer).
    return <html.span>{link.label}</html.span>;
  }

  // The related row opens from its name with a pointer; on a touch
  // screen from a button beside it, so a tap on the cell still selects it
  // and a second opens the picker (CellLink).
  return (
    <CellLink onOpen={() => onOpenRelation(link.address)} label={`Open ${link.label}`} style={styles.relationLink}>
      {link.label}
    </CellLink>
  );
}

interface EditableCellProps {
  field: Field | undefined;
  value: unknown;
  onCommit: (next: unknown) => void;
  /** Forwarded to CellValue for relation-cell rendering in idle state. */
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
  /** Forwarded to CellValue: the lines of text the row has room for. */
  lines?: number;
  /** The column's alignment, which the idle cell fills the width to keep. */
  align?: FieldAlignment;
  /** Open for typing as soon as it appears: a row just added. */
  autoEdit?: boolean;
  /**
   * In a table with a selected cell: a click on an unselected cell only
   * selects it, and a click on the selected one edits.
   * Absent outside a table, where a click edits as before.
   */
  selected?: boolean;
  /**
   * Select this cell. The cell calls it itself: on native a click reaches
   * only the innermost pressable, never the table's own handler.
   */
  onSelect?: () => void;
  /**
   * For an attachment column: what editing does instead of typing a name,
   * such as choosing a file to copy into the table's folder. Absent, the
   * name is typed as before.
   */
  onAttach?: () => void;
  /** Start editing; `text` replaces the value (a key typed on the cell). */
  editRequest?: EditRequest;
  /** Told once the cell has taken `editRequest`, for the table to let it go. */
  onEditHeard?: () => void;
  /** How editing ended from the keyboard, so the table can move on. */
  onEditEnd?: (how: EditEnd) => void;
  /**
   * An editor outside the cell (#352): asked first whenever the cell would
   * start editing; true means it took the edit and the cell stays idle.
   */
  editOutside?: (text?: string) => boolean;
  /** That editor's draft, shown in the cell as it is typed. */
  outsideDraft?: string;
}

/** A request from the table to open a cell; `n` changes for each one. */
export interface EditRequest {
  n: number;
  text?: string;
}
export type EditEnd = "enter" | "tab" | "shift-tab" | "escape" | "done";

/** What a key event carries on the web, beyond RSD's `{ key }`. */
interface KeyEventLike {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  preventDefault?: () => void;
  target?: unknown;
}

function EditableCell({
  field,
  value,
  onCommit,
  relatedTables,
  onOpenRelation,
  lines,
  align,
  autoEdit,
  selected,
  onSelect,
  onAttach,
  editRequest,
  onEditHeard,
  onEditEnd,
  editOutside,
  outsideDraft,
}: EditableCellProps) {
  // A computed field is derived on read and never stored, so there is
  // nothing to edit. (Hooks below stay unconditional; this only picks
  // what renders.)
  const kind = editorKind(field);
  const readOnly = kind === "readonly";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  // Why the draft wasn't saved (D42), and which draft an early year was
  // already queried for, so Enter again keeps it.
  const [problem, setProblem] = useState<(CellCheck & { ok: false }) | null>(null);
  // Where to show it: over the table, which clips anything that leaves a cell.
  const [problemAt, setProblemAt] = useState<AnchorRect | null>(null);
  const queried = useRef<string | null>(null);
  // Once the edit is saved or cancelled, the input's blur (which fires as
  // it goes away) mustn't save the draft again over what was chosen.
  const closed = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);
  // Long text (a markdown string) is written in a box over the cell, where
  // lines have room; the cell itself is a row high. Measured from the cell.
  const cellAnchor = useRef<HTMLElement | null>(null);
  const [longAt, setLongAt] = useState<AnchorRect | null>(null);
  // Opened by typing a character: the caret goes after it, so the next
  // one adds to it. Opened any other way, the whole value is selected.
  const caretAtEnd = useRef(false);
  const hints = inputHints(field);
  const { Select: SelectControl, DateInput: DateInputControl } = usePlatformControls();

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      applyKeyboard(el, hints);
      if (caretAtEnd.current && el && "setSelectionRange" in el) {
        focusInput(el);
        // A native input's ref doesn't carry its value: what was typed is the draft.
        const end = (typeof el.value === "string" ? el.value : draft).length;
        try {
          el.setSelectionRange(end, end);
        } catch {
          // number and date inputs have no caret to place
        }
      } else if (el && "select" in el && typeof el.select === "function") el.select();
      else focusInput(el);
    }
  }, [editing]);

  const startEdit = (text?: string) => {
    if (editOutside?.(text)) return;
    closed.current = false;
    caretAtEnd.current = text !== undefined;
    setDraft(text ?? draftOf(value));
    setProblem(null);
    queried.current = null;
    setEditing(true);
  };
  // A click edits the selected cell; an unselected one it leaves to the
  // table to select. Outside a table (no `selected`), a click edits.
  const clickToEdit = () => {
    if (selected === false) onSelect?.();
    else if (kind === "attachment" && onAttach) onAttach();
    else startEdit();
  };

  /**
   * Save the draft if the column can hold it (D42). Returns false, and
   * keeps the cell open with the reason, when it can't. On blur there's
   * no one to ask: a value that can't be held is dropped, and an early
   * year is kept, since it's a valid date.
   */
  const commit = (raw: string, how: "key" | "blur" = "key"): boolean => {
    const result = commitDraft(field, value, raw, how, queried.current);
    if (result.kind === "problem") {
      queried.current = result.queried;
      setProblem(result.check);
      void measureAnchor(inputRef.current).then(setProblemAt);
      return false;
    }
    closed.current = true;
    setEditing(false);
    setProblem(null);
    if (result.kind === "dropped") return false;
    if (result.kind === "save") onCommit(result.value);
    return true;
  };

  const cancel = () => {
    closed.current = true;
    setEditing(false);
    setProblem(null);
  };

  useEffect(() => {
    if (autoEdit && !readOnly) startEdit();
    // Only as the cell first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editRequest && !readOnly) {
      if (kind === "attachment" && onAttach) onAttach();
      else startEdit(editRequest.text);
    }
    if (editRequest) onEditHeard?.();
    // Each request once, as it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.n]);

  // Enter saves and moves down, Tab saves and moves across, Escape
  // cancels; each hands the keyboard back to the table.
  const onEditKey = (e: KeyEventLike) => {
    if (e.key === "Enter") {
      if (commit(draft)) onEditEnd?.("enter");
    } else if (e.key === "Tab") {
      e.preventDefault?.();
      if (commit(draft)) onEditEnd?.(e.shiftKey ? "shift-tab" : "tab");
    } else if (e.key === "Escape") {
      cancel();
      onEditEnd?.("escape");
    }
  };

  if (readOnly) {
    return (
      <CellValue field={field} value={value} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={lines} />
    );
  }

  // Being edited outside the cell: show what is typed, as it is typed.
  if (outsideDraft !== undefined) {
    return (
      <html.div onClick={clickToEdit} style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}>
        <html.span dir="auto" style={styles.cellOutsideDraft}>{outsideDraft}</html.span>
      </html.div>
    );
  }

  // Boolean: toggle on click, no draft state
  if (kind === "boolean") {
    return (
      <Toggle
        role="cell"
        checked={value === true}
        label={field?.title ?? field?.name}
        onChange={(checked) => {
          onSelect?.();
          onCommit(checked);
        }}
      />
    );
  }

  // A multi-select or a link with an outside editor: picked there, links
  // to many rows included (the editor ticks them on and off), as long as
  // there are rows to link to.
  if (
    field &&
    editOutside &&
    ((kind === "list" && enumOptions(field).length > 0) || (kind === "relation" && relationOptions(field, relatedTables).length > 0))
  ) {
    return (
      <html.div onClick={clickToEdit} style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}>
        <CellValue field={field} value={value} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={lines} />
      </html.div>
    );
  }

  // A list: a multi-select picks from its choices; a plain list is typed
  // as comma-separated text.
  // A relation to many rows is ticked on and off, as a multi-select is.
  if (kind === "relation" && relatesMany(field) && field) {
    return (
      <ListCell
        field={field}
        value={value}
        onCommit={onCommit}
        relatedTables={relatedTables}
        lines={lines}
        selected={selected}
        onSelect={onSelect}
        editRequest={editRequest}
        onEditEnd={onEditEnd}
        choices={relationOptions(field, relatedTables)}
        toggled={(id) => relationToggled(field, value, id, relatedTables)}
        onOpenRelation={onOpenRelation}
      />
    );
  }

  if (kind === "list" && field) {
    return (
      <ListCell
        field={field}
        value={value}
        onCommit={onCommit}
        relatedTables={relatedTables}
        lines={lines}
        selected={selected}
        onSelect={onSelect}
        editRequest={editRequest}
        onEditEnd={onEditEnd}
      />
    );
  }

  // Enum: select dropdown. Normalised via enumOptions() so both the
  // bare-string and { value, color, label } on-disk forms render.
  const enumOpts = enumOptions(field);
  // A relation to one row is picked the same way, from the related table's rows.
  const singleRelation = kind === "relation" && !relatesMany(field);
  const choiceOpts = singleRelation
    ? relationOptions(field, relatedTables)
    : enumOpts.map((opt) => ({ value: opt.value, label: opt.label ?? opt.value }));
  if (kind === "choice" || singleRelation) {
    if (!editing) {
      const shown = (
        <CellValue
          field={field}
          value={value}
          relatedTables={relatedTables}
          onOpenRelation={onOpenRelation}
          lines={lines}
        />
      );
      // On a phone the selected cell is itself the system's menu of
      // choices: its next tap chooses, as a text cell's next tap types.
      // Not a relation: its value has a button of its own (CellLink),
      // which a menu's label would swallow.
      // An outside editor offers the choices itself.
      if (kind === "choice" && selected !== false && SelectControl.opensFromTrigger && !editOutside) {
        return (
          <Select
            value={typeof value === "string" ? value : ""}
            options={[{ value: "", label: EMPTY_TEXT }, ...choiceOpts]}
            onChange={(next) => {
              commit(next);
              onEditEnd?.("done");
            }}
            label={field?.title ?? field?.name}
            trigger={<html.div style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}>{shown}</html.div>}
          />
        );
      }
      return (
        <html.div onClick={clickToEdit} style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}>
          {shown}
        </html.div>
      );
    }
    return (
      <Select
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={inputRef as any}
        value={typeof value === "string" ? value : ""}
        options={[{ value: "", label: EMPTY_TEXT }, ...choiceOpts]}
        onChange={(next) => {
          commit(next);
          onEditEnd?.("done");
        }}
        onKeyDown={(e: KeyEventLike) => {
          if (e.key === "Escape") {
            cancel();
            onEditEnd?.("escape");
          } else if (e.key === "Tab") {
            e.preventDefault?.();
            cancel();
            onEditEnd?.(e.shiftKey ? "shift-tab" : "tab");
          }
        }}
        onBlur={cancel}
        style={styles.cellInput}
      />
    );
  }

  // Text/number/integer: text input on click
  if (!editing) {
    const shown = (
      <CellValue
        field={field}
        value={value}
        relatedTables={relatedTables}
        onOpenRelation={onOpenRelation}
        lines={lines}
      />
    );
    // On a phone a selected date, time, or date and time is the system's
    // picker: its next tap picks, and typing on it still edits the text.
    const pickedKind = hints.kind === "date" || hints.kind === "time" || hints.kind === "datetime" ? hints.kind : null;
    if (pickedKind && selected !== false && DateInputControl.available && !editOutside) {
      return (
        <DateInputControl
          kind={pickedKind}
          value={draftOf(value)}
          onChange={(next) => {
            commit(next);
            onEditEnd?.("done");
          }}
          label={field?.title ?? field?.name}
          trigger={<html.div style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}>{shown}</html.div>}
        />
      );
    }
    return (
      <html.div onClick={clickToEdit} style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}>
        {shown}
      </html.div>
    );
  }

  // Native HTML5 controls for time-shaped fields. On RN these would be
  // swapped for @react-native-community/datetimepicker (or similar); the
  // RSD strict-subset purity is deliberately broken here in favour of
  // platform-native pickers — see PR description.
  const inputType = inputKind(field);
  // The stored value is a plain number; a currency format only changes
  // how it's shown. While editing, show the symbol beside the input so
  // it's clear what the number is in.
  const currencySymbol = currencySymbolOf(field);
  // Long text: the cell shows its value as it stands, and the writing is
  // done in a box over it. Enter is a new line, as in a row's page;
  // ⌘/Ctrl+Enter saves and moves down; Escape cancels; clicking away saves.
  if (field?.format === "markdown" && kind === "text") {
    return (
      <>
        <html.span
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={(el: any) => {
            if (el && !cellAnchor.current) {
              cellAnchor.current = el;
              void measureAnchor(el).then(setLongAt);
            }
          }}
          style={[styles.cellEditableIdle, cellAlignStyle(align ?? "start")]}
        >
          <CellValue field={field} value={value} relatedTables={relatedTables} lines={lines} />
        </html.span>
        {longAt && (
          <Portal>
            <html.textarea
              dir="auto"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ref={(el: any) => {
                if (el && inputRef.current !== el) {
                  inputRef.current = el;
                  focusInput(el);
                  const end = el.value.length;
                  el.setSelectionRange?.(caretAtEnd.current ? end : 0, end);
                }
              }}
              aria-label={field.title ?? field.name}
              value={draft}
              onChange={(e: { target: { value: string } }) => {
                setDraft(e.target.value);
                setProblem(null);
              }}
              onBlur={() => {
                if (!closed.current) commit(draft, "blur");
              }}
              onKeyDown={(e: KeyEventLike) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault?.();
                  if (commit(draft)) onEditEnd?.("enter");
                } else if (e.key === "Enter") return;
                else onEditKey(e);
              }}
              style={[styles.cellLongText, styles.cellLongTextAt(longAt.top - 2, longAt.left - 2, Math.max(longAt.width + 4, 320))]}
            />
          </Portal>
        )}
      </>
    );
  }
  const input = (
    <html.input
        dir="auto"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={inputRef as any}
      // The keyboard the field wants: a number pad, an @ for an email, no
      // capitals or corrections in a code (inputHints).
      {...inputAttributes(hints, inputType)}
      value={draft}
      onChange={(e: { target: { value: string } }) => {
        setDraft(e.target.value);
        setProblem(null);
      }}
      onBlur={() => {
        if (!closed.current) commit(draft, "blur");
      }}
      onKeyDown={onEditKey}
      aria-invalid={problem && !problem.confirmable ? true : undefined}
      style={[styles.cellInput, cellInputFit]}
    />
  );
  // A div, not a span: on native a span is a run of text, and an input inside one doesn't sit on its line.
  const field_ = currencySymbol ? (
    <html.div style={styles.cellInputAffixed}>
      <html.span style={styles.cellInputAffix}>{currencySymbol}</html.span>
      {input}
    </html.div>
  ) : (
    input
  );
  if (!problem || !problemAt) return field_;
  return (
    <>
      {field_}
      <Portal>
      <html.span
        role="alert"
        style={[
          styles.cellProblem,
          // Kept inside the window: a cell in the last column is near its edge.
          styles.cellProblemAt(
            problemAt.top + problemAt.height + 6,
            !hasWindowSize() ? problemAt.left - 8 : Math.max(8, Math.min(problemAt.left - 8, window.innerWidth - 348)),
          ),
          problem.confirmable ? styles.cellProblemAsk : styles.cellProblemRefused,
        ]}
      >
        {problem.message}
        {problem.suggestion && (
          <html.button
            style={styles.cellProblemFix}
            // Keeps the input focused, so no blur saves the draft first.
            onMouseDown={(e: { preventDefault?: () => void }) => e.preventDefault?.()}
            onClick={() => {
              setDraft(problem.suggestion!);
              if (commit(problem.suggestion!)) onEditEnd?.("done");
            }}
          >
            Use {problem.suggestion.slice(0, 4)}
          </html.button>
        )}
      </html.span>
      </Portal>
    </>
  );
}

/**
 * A list cell (D35). With a choice list it opens a picker of the choices,
 * each toggled on click and saved straight away, as Notion's multi-select
 * does; without one it's typed as comma-separated text.
 */
function ListCell({
  field,
  value,
  onCommit,
  relatedTables,
  lines,
  selected,
  onSelect,
  editRequest,
  onEditEnd,
  choices,
  toggled,
  onOpenRelation,
}: {
  field: Field;
  value: unknown;
  /** A related row's link, opened: shown as links, as a relation cell is. */
  onOpenRelation?: (address: string) => void;
  /** The choices, when they aren't the field's own (a relation's rows). */
  choices?: { value: string; label?: string }[];
  /** The value with a choice toggled, when that isn't listToggled's (a relation keeps its table's order). */
  toggled?: (choice: string) => unknown;
  onCommit: (next: unknown) => void;
  relatedTables?: Record<string, ParsedTable>;
  lines?: number;
  selected?: boolean;
  onSelect?: () => void;
  editRequest?: EditRequest;
  onEditEnd?: (how: EditEnd) => void;
}) {
  const items = listItems(value);
  const options = choices ?? enumOptions(field);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // Whether the text box was focused since it opened: once, not on every keystroke.
  const textFocused = useRef(false);
  if (!open) textFocused.current = false;
  const [rect, setRect] = useState<AnchorRect | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchor = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const optionRefs = useRef<any[]>([]);
  const openPicker = async () => {
    setText(listText(value));
    setRect(await measureAnchor(anchor.current));
    setOpen(true);
  };
  useEffect(() => {
    if (editRequest) void openPicker();
    // Each request once, as it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.n]);
  // Opened: the first choice has focus, so arrows and Space work at once.
  useEffect(() => {
    if (open) optionRefs.current[0]?.focus?.();
  }, [open]);
  const close = (how: EditEnd) => {
    setOpen(false);
    onEditEnd?.(how);
  };
  // Up and down move between choices; Space or Enter toggles (the
  // button's own); Escape closes; Tab closes and moves across.
  const onPickerKey = (e: KeyEventLike) => {
    const at = optionRefs.current.findIndex((el) => el === e.target);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault?.();
      const next = Math.max(0, Math.min(options.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
      optionRefs.current[next]?.focus?.();
    } else if (e.key === "Escape") {
      close("done");
    } else if (e.key === "Tab") {
      e.preventDefault?.();
      close(e.shiftKey ? "shift-tab" : "tab");
    }
  };
  const shown = (
    <html.div
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={(el: any) => {
        anchor.current = el;
      }}
      onClick={() => {
        if (selected !== false) void openPicker();
        else onSelect?.();
      }}
      style={styles.cellEditableIdle}
    >
      <CellValue field={field} value={value} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={lines} />
    </html.div>
  );
  if (!open) return shown;
  if (options.length === 0) {
    const commit = () => {
      setOpen(false);
      onCommit(listFromText(text));
    };
    return (
      <html.input
        dir="auto"
        type="text"
        autoFocus
        // RSD drops autoFocus on native, so it's focused here too, once (#281).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(el: any) => {
          if (!el || textFocused.current) return;
          textFocused.current = true;
          focusInput(el);
        }}
        value={text}
        placeholder="a, b, c"
        onChange={(e: { target: { value: string } }) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e: KeyEventLike) => {
          if (e.key === "Enter") {
            commit();
            onEditEnd?.("enter");
          } else if (e.key === "Escape") close("escape");
        }}
        style={styles.cellInput}
      />
    );
  }
  const toggle = (choice: string) => onCommit(toggled ? toggled(choice) : listToggled(field, value, choice));
  return (
    <>
      {shown}
      <Portal>
        <html.div style={styles.rowMenuBackdrop} onClick={() => setOpen(false)} />
        <html.div
          role="listbox"
          aria-multiselectable={true}
          onKeyDown={onPickerKey}
          style={[
            styles.rowMenu,
            styles.rowMenuAt(
              (rect?.top ?? 0) + (rect?.height ?? 0) + 4,
              !hasWindowSize() ? (rect?.left ?? 0) : Math.min(rect?.left ?? 0, window.innerWidth - 200),
            ),
          ]}
        >
          {options.map((o, i) => (
            <html.button
              key={o.value}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ref={(el: any) => {
                optionRefs.current[i] = el;
              }}
              role="option"
              aria-selected={items.includes(o.value)}
              style={[styles.rowMenuItem, styles.choiceItem]}
              onClick={() => toggle(o.value)}
            >
              <html.span style={styles.choiceCheck}>{items.includes(o.value) ? "✓" : ""}</html.span>
              {/* A relation's rows are named, not coloured choices. */}
              {choices ? <html.span>{o.label ?? o.value}</html.span> : <EnumPill pill={pillFor(field, o.value)} />}
            </html.button>
          ))}
        </html.div>
      </Portal>
    </>
  );
}

/** The symbol for a `currency:XXX` format, in the reader's locale, or null. */



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

function BodyBadge({ onClick, besideTitle }: { onClick?: () => void; besideTitle?: boolean }) {
  if (!onClick) return <html.span style={[styles.bodyBadge, besideTitle && styles.bodyBadgeBesideTitle]}>page</html.span>;
  // Beside a title, the hint's wrapper takes the badge's place and margins:
  // on native it's a Text, and a button inside one loses its own.
  return (
    <Hinted hint="This row has a page. Click to open it." style={besideTitle ? styles.bodyBadgeHintBesideTitle : undefined}>
    <html.button
      aria-label="Open page"
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onClick();
      }}
      style={[styles.bodyBadge, styles.bodyBadgeButton, besideTitle && styles.bodyBadgeButtonBesideTitle]}
    >
      page
    </html.button>
    </Hinted>
  );
}

/**
 * Edge to edge (`on`): what it holds scrolls sideways over the page's
 * margins to the screen's edges, starting and ending in line with the
 * page. Off: as it is.
 */
function EdgeToEdge({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <Bleed>
      <HScroll>
        <html.div style={styles.bleedRow}>
          <GutterSpacer />
          {children}
          <GutterSpacer />
        </html.div>
      </HScroll>
    </Bleed>
  );
}

/** The columns beside a pinned one scroll inside the frame (`on`); edge to edge, the frame scrolls instead. */
function PaneScroll({ on, children, scroll }: { on: boolean; children: ReactNode; scroll?: { ref: { current: unknown }; x: { current: number } } }) {
  return on ? (
    <HScroll
      // HScroll spreads these onto its ScrollView, ref included (its type leaves the ref out).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scrollProps={
        scroll &&
        ({
          ref: scroll.ref,
          onScroll: (e: { nativeEvent: { contentOffset: { x: number } } }) => void (scroll.x.current = e.nativeEvent.contentOffset.x),
          scrollEventThrottle: 16,
        } as any)
      }
    >
      {children}
    </HScroll>
  ) : (
    <>{children}</>
  );
}

/** A cell's draft ("2026-03-01", "09:30", "2026-03-01T09:30") as a Date for the system's picker. */
function dateOfDraft(draft: string, kind: InputHintKind): Date | undefined {
  if (!draft) return undefined;
  if (kind === "time") {
    const [h, m] = draft.split(":").map(Number);
    if (h === undefined || Number.isNaN(h)) return undefined;
    const d = new Date();
    d.setHours(h, m ?? 0, 0, 0);
    return d;
  }
  const [date, time] = draft.split("T");
  const [y, mo, da] = (date ?? "").split("-").map(Number);
  if (!y || !mo || !da) return undefined;
  const [h, mi] = (time ?? "").split(":").map(Number);
  return new Date(y, mo - 1, da, h || 0, mi || 0);
}

/** A picked Date as the draft a cell of this kind takes, in local time. */
function draftOfDate(d: Date, kind: InputHintKind): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return kind === "date" ? date : kind === "time" ? time : `${date}T${time}`;
}

/** The outside editor's keyboard for each kind of entry (inputHints); a signed number needs a minus. */
const BAR_KEYBOARD: Partial<Record<InputHintKind, NonNullable<CellEditSession["keyboard"]>>> = {
  integer: "numeric",
  decimal: "decimal-pad",
  "signed-decimal": "numbers-and-punctuation",
  email: "email-address",
  url: "url",
  phone: "phone-pad",
};

/** A row at its place, with the group it starts, if any. */
type RowEntry = { row: Row; starts?: { label: string; count: number } };
const NO_SOURCE = memoryViewRows([]);
const NO_IDS: readonly string[] = [];
const NO_ENTRIES: RowEntry[] = [];

export function TableView({
  view,
  rows,
  schema,
  bodies,
  relatedTables,
  onUpdateRow,
  onUpdateField,
  onAddEnumValue,
  onRemoveEnumValue,
  onDeleteField,
  onMoveField,
  onRestoreSchema,
  onAddField,
  onAddRow,
  onDeleteRow,
  onOpenBody,
  onOpenRelation,
  onUpdateView,
  allRows,
  source: given,
  tableKey,
  sheet,
  onInsertRow,
  onAttachFile,
  onPlace,
  restorePlace,
  onPlaceMeasure,
}: ViewProps) {
  const display = useDisplaySettings();
  const { formulaSyntax } = display;
  const rtl = useDirection() === "rtl";
  const fields = visibleFields(view, schema);
  const fieldMap = fieldsByName(schema);
  const titleField = fields[0];

  // Resizing: live values while a handle is dragged, committed to the
  // view (columnWidths / rowHeights, SPEC section 4) when it's let go.
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [liveRow, setLiveRow] = useState<{ rowId: string; h: number } | null>(null);
  const resizeStart = useRef<{ at: number; size: number } | null>(null);
  // Each row's own height, else the view's default; the row being
  // resized follows the drag.
  const heightOf = (rowId: string) => (liveRow?.rowId === rowId ? liveRow.h : rowHeightOf(view, rowId));
  const haptics = useHaptics();
  // The height the drag last ticked at, so each line passed ticks once.
  const lastStep = useRef(0);
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null);
  // The schema as a field's settings opened, for their Cancel to put back.
  const schemaBefore = useRef<TableSchema | null>(null);
  useEffect(() => {
    schemaBefore.current = editingFieldName ? schema : null;
    // Only on opening and closing: what's changed since is what Cancel undoes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFieldName]);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  // Ref typed loosely (`unknown`) because the underlying instance differs
  // per platform — HTMLButtonElement on web, a Pressable view ref on
  // native. measureAnchor() handles the platform-specific measurement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerButtonRefs = useRef<Record<string, any>>({});
  const schemaEditable = !!(onUpdateField && onAddEnumValue && onMoveField);
  // A formula cell opened to see how it was worked out: which row and
  // column, and where to anchor the panel. While it's open, the column is
  // tinted and the cells it read in that row are outlined.
  const [formulaCell, setFormulaCell] = useState<{ rowId: string; name: string; rect: AnchorRect } | null>(null);
  // A row's actions (open its page, insert, delete), offered the
  // platform's way: right-click on the web and macOS, touch and hold on a
  // phone. A host can replace the control (PlatformControlsProvider).
  const { RowActions } = usePlatformControls();
  const actionsFor = (rowId: string) =>
    rowActions(rowId, { onOpenBody, hasBody: bodies?.[rowId] !== undefined, onInsertRow, onDeleteRow });
  // The totals footer (SPEC section 4, `totals`), like Notion's Calculate.
  const [totalsMenu, setTotalsMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const { Select: TotalsSelect } = usePlatformControls();
  /** The totals a column can show: sums and the like for numbers, counts for anything. */
  const totalKindsFor = (field: Field | undefined): ViewTotal[] => {
    const isNumber = field?.type === "number" || field?.type === "integer" || field?.type === "year" || field?.computed !== undefined;
    return [...(isNumber ? (["sum", "average", "min", "max"] as ViewTotal[]) : []), "count", "count_empty"];
  };
  const chooseTotal = (name: string, kind: ViewTotal | null) => {
    const next = { ...(view.totals ?? {}) };
    if (kind) next[name] = kind;
    else delete next[name];
    onUpdateView?.({ totals: Object.keys(next).length ? next : undefined });
    setTotalsMenu(null);
  };
  // The row just added from "+ New row": its first cell opens for typing
  // as it appears, then this clears (the cell's effect runs first).
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  // The selected cell, as a spreadsheet has one: arrows move it, Enter or
  // typing edits it (#85). Cleared when focus leaves the table.
  const [sel, setSel] = useState<{ rowId: string; name: string } | null>(null);
  // A cell asked to open for editing (Enter, or a key typed on it). It clears
  // once the cell has heard it (`onEditHeard`), so the cell doesn't open
  // again when its row is scrolled away and drawn anew.
  const [editReq, setEditReq] = useState<{ rowId: string; name: string; req: EditRequest } | null>(null);
  const editHeard = useCallback(() => setEditReq(null), []);
  // An editor outside the table (#352), when the host provides one: the
  // draft it is typing into a cell, or into a formula column, shown live.
  const editor = useCellEditor();
  const [barDraft, setBarDraft] = useState<{ rowId: string; name: string; text: string } | null>(null);
  const [barFormula, setBarFormula] = useState<{ rowId: string; name: string; draft: string } | null>(null);
  const barSession = useRef<CellEditSession | null>(null);
  const barSeq = useRef(0);
  // Another view or table on screen (or this one gone): the open edit ends
  // with it, discarded. Without this the editor kept editing a field that
  // was no longer shown. Not saved: by now the app's active table may be
  // another, and a save writes to the active table.
  useEffect(
    () => () => {
      const open = barSession.current;
      if (!open) return;
      barSession.current = null;
      open.cancel();
      editor?.end(open.key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, view.id, tableKey],
  );
  // When this table goes (another view, another table), nothing in it is
  // selected any more: the editor is told, or it goes on showing the cell.
  useEffect(() => () => editor?.select(null), [editor, view.id, tableKey]);
  // The editor shows the selected cell, and can deselect it or edit it.
  useEffect(() => {
    if (!editor) return;
    const row = sel ? rowOf(sel.rowId) : undefined;
    const field = sel ? fieldMap.get(sel.name) : undefined;
    if (!sel || !row || !field) return editor.select(null);
    editor.select({
      rowId: sel.rowId,
      name: sel.name,
      label: field.title ?? field.name,
      rowLabel: titleField ? formatValue(row[titleField]) : row.id,
      text: field.computed
        ? formulaDraftOf(field, grid ? { ...grid, here: sel.rowId } : undefined, formulaSyntax)
        : field.relation
          ? // A link reads as the rows it points at, as the cell shows them.
            (() => {
              const names = new Map(relationOptions(field, relatedTables).map((o) => [o.value, o.label] as const));
              const ids = Array.isArray(row[sel.name]) ? listItems(row[sel.name]) : row[sel.name] ? [String(row[sel.name])] : [];
              return ids.map((id) => names.get(id) ?? id).join(", ");
            })()
          : formatCellValue(field, row[sel.name]),
      formula: field.computed !== undefined,
      ...(field.description ? { description: field.description } : {}),
      // What the web's header hover says, for a platform with no hover.
      facts: (() => {
        const hint = fieldHint({ field, name: sel.name, schema, editable: false, formulaSyntax });
        return [hint.facts.join(" · "), hint.description, hint.formula, hint.storedAs].filter(Boolean).join("\n\n");
      })(),
    });
  });
  useEffect(() => {
    if (!editor) return;
    editor.attach({
      deselect: () => setSel(null),
      editSelected: () => void (sel && openCell(sel.rowId, sel.name)),
      revealSelected: () => void (sel && measureAnchor(cellRefs.current[`${sel.rowId}\u0000${sel.name}`]).then((rect) => rect && editor.reveal?.(rect))),
      // As clicking the heading does; a sheet ignores where the heading is,
      // but the editor waits for a place, so a heading scrolled away still opens it.
      ...(schemaEditable
        ? {
            openFieldSettings: (name: string) => {
              setFormulaCell(null);
              void measureAnchor(headerButtonRefs.current[name]).then((rect) => {
                setAnchorRect(rect ?? { top: 0, left: 0, width: 0, height: 0 });
                setEditingFieldName(name);
              });
            },
          }
        : {}),
    });
  });
  useEffect(() => () => editor?.attach(null), [editor]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gridRef = useRef<any>(null);
  // Where the keys come from on macOS, which needs a view of its own for them (GridKeys).
  const keysRef = useRef<GridKeysHandle | null>(null);
  // On the Mac, a table that comes into view takes the keyboard, so the first
  // arrow selects its first cell (gridKey) without a click first. Not on the
  // web, where focusing would scroll the page, nor on a phone.
  useEffect(() => {
    if (Platform.OS !== "macos") return;
    const t = setTimeout(() => keysRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id]);
  useEffect(() => {
    // A row in the index is selected by its id whether or not it's on screen: the list goes to it.
    if (focusRowId && (indexed || rows.some((r) => r.id === focusRowId))) {
      setSel({ rowId: focusRowId, name: fields[0]! });
      setFocusRowId(null);
    }
  }, [rows, focusRowId, given?.version]);
  const [newRowHot, setNewRowHot] = useState(false);
  const addRow = onAddRow
    ? () => {
        const id = onAddRow();
        if (typeof id === "string") setFocusRowId(id);
      }
    : undefined;
  const totals = view.totals ?? {};
  // Where totals are chosen in the view's settings (a phone's settings
  // form), an empty footer is only noise: it shows once a column has a total.
  const { SettingsForm: settingsForm } = usePlatformControls();
  const showTotals = Object.keys(totals).length > 0 || (!!onUpdateView && !settingsForm);
  // No totals chosen: the footer is only a place to choose one, so it
  // stays quiet (no fill, rules or separators) until "Calculate" is hovered.
  const quietTotals = Object.keys(totals).length === 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cellRefs = useRef<Record<string, any>>({});
  const openFormulaField = formulaCell ? fieldMap.get(formulaCell.name) : undefined;
  // A sheet (SPEC section 4, `coordinates`): lettered columns, numbered
  // rows, in this view's order, and formulas typed and shown as =B7.
  const coords = view.coordinates === true;
  // The rows, by place: in group order when the view groups, and row numbers
  // follow what's shown. They are either all here (`rows`), or in the index
  // (`source`), read a window at a time around what the list is showing. A
  // row of the index that hasn't arrived has no entry, and is drawn empty at
  // its height.
  const indexed = given !== undefined;
  const [shownRange, setShownRange] = useState({ start: 0, end: 80 });
  const windowRows = useViewWindow(given ?? NO_SOURCE, shownRange.start, shownRange.end);
  const windowStart = Math.max(0, shownRange.start);
  // Rows with a height of their own, by id: their places come from the source.
  const ownHeights = useMemo(
    () => [...new Set([...Object.keys(view.rowHeights ?? {}), ...(liveRow ? [liveRow.rowId] : [])])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.rowHeights, liveRow?.rowId],
  );
  const facts = useViewFacts(given ?? NO_SOURCE, indexed ? ownHeights : NO_IDS);
  const inMemory = indexed ? NO_ENTRIES : groupedRows(view, rows, schema);
  const total = indexed ? given.count : inMemory.length;
  const groupStarts = indexed
    ? new Map(facts.groups.map((g) => [g.start, { label: groupLabel(g.key, view.group?.field ?? "", schema), count: g.count }] as const))
    : null;
  const startsAt = (place: number) => (groupStarts ? groupStarts.get(place) : inMemory[place]?.starts);
  const entryAt = (place: number): RowEntry | undefined => {
    if (!groupStarts) return inMemory[place];
    const row = windowRows[place - windowStart];
    if (!row) return undefined;
    const starts = groupStarts.get(place);
    return starts ? { row, starts } : { row };
  };
  const idAt = (place: number) => entryAt(place)?.row.id;
  // The rows held, by id: all of them in memory, the window's of an index.
  let heldById: { place: Map<string, number>; row: Map<string, Row> } | null = null;
  const held = () => {
    if (heldById) return heldById;
    const place = new Map<string, number>();
    const row = new Map<string, Row>();
    const hold = (r: Row, at: number) => {
      if (place.has(r.id)) return;
      place.set(r.id, at);
      row.set(r.id, r);
    };
    if (indexed) windowRows.forEach((r, i) => r && hold(r, windowStart + i));
    else inMemory.forEach((d, i) => hold(d.row, i));
    return (heldById = { place, row });
  };
  const placeOfId = (id: string) => held().place.get(id) ?? -1;
  const rowOf = (id: string) => held().row.get(id);
  // The rows go through a list that draws only what's on screen (RowList):
  // each item is a place: its row and, when it starts a group, the band above it.
  const places = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  const rowKeyOf = (place: number) => (indexed ? String(place) : (idAt(place) ?? String(place)));
  const defaultHeight = view.rowHeight ?? DEFAULT_ROW_HEIGHT;
  // The places of the rows with a height of their own.
  const tallAt = new Map<number, number>();
  for (const id of ownHeights) {
    const place = indexed ? (facts.places.get(id) ?? -1) : placeOfId(id);
    if (place >= 0) tallAt.set(place, heightOf(id));
  }
  // A row's border is outside its height, so it adds its 1 px, except under
  // the last row when nothing follows it (tableRowLast). A group's band adds
  // its height and border likewise.
  const rowItemHeight = (place: number) =>
    (tallAt.get(place) ?? defaultHeight) +
    (place === total - 1 && !onAddRow ? 0 : ROW_BORDER) +
    (startsAt(place) ? GROUP_ROW_HEIGHT + ROW_BORDER : 0);
  const rowsVersion = `${view.rowHeight ?? ""}|${JSON.stringify(view.rowHeights ?? {})}|${liveRow?.rowId ?? ""}:${liveRow?.h ?? ""}|${
    // Not the source's own version: an edit changes that, and no row's height.
    indexed
      ? `${given.count}:${facts.groups.map((g) => g.start).join(",")}:${[...facts.places.values()].join(",")}`
      : // In memory: where each group starts (an edit can move a row to another group, and its heading with it), and which rows are tall.
        `${total}:${view.group ? inMemory.flatMap((d, place) => (d.starts ? [place] : [])).join(",") : ""}:${[...tallAt.keys()].join(",")}`
  }|${
    // The last row has no rule under it when nothing follows it.
    onAddRow ? 1 : 0
  }`;
  // The selected row's grip hangs below it, over the next row.
  const rowRaised = (place: number) => !!sel && idAt(place) === sel.rowId;
  // Every place's top, without drawing any: for going to a row and for saying where one is.
  const layoutOf = () => {
    const marks: RowMark[] = [];
    if (groupStarts) for (const place of groupStarts.keys()) marks.push({ place, before: GROUP_ROW_HEIGHT + ROW_BORDER });
    else inMemory.forEach((d, place) => d.starts && marks.push({ place, before: GROUP_ROW_HEIGHT + ROW_BORDER }));
    for (const [place, height] of tallAt) marks.push({ place, taller: height - defaultHeight });
    return rowLayout(total, defaultHeight + ROW_BORDER, marks);
  };
  // A table too tall for a list to lay out as it is gives the list where every row is.
  const tallLayout = total * (defaultHeight + ROW_BORDER) > MAX_LIST_HEIGHT ? layoutOf : undefined;
  /** A place's item: its row as `draw` draws it, or an empty row of its height while it's on its way from the index. */
  const drawn = (place: number, draw: (entry: RowEntry, place: number) => ReactNode): ReactNode => {
    const entry = entryAt(place);
    if (entry) return draw(entry, place);
    return (
      <>
        {startsAt(place) && <html.div style={[styles.tableRow, styles.groupRow]} />}
        <html.div
          style={[styles.tableRow, styles.rowHeight(tallAt.get(place) ?? defaultHeight), place === total - 1 && !onAddRow && styles.tableRowLast]}
        />
      </>
    );
  };
  // What the list is showing decides the window read from an index, with room either side.
  const onShown = indexed
    ? (first: number, last: number) => {
        const start = Math.max(0, Math.floor((first - 60) / 40) * 40);
        const end = Math.ceil((last + 60) / 40) * 40;
        setShownRange((was) => (was.start === start && was.end === end ? was : { start, end }));
      }
    : undefined;
  const frozenRows = useRef<RowListHandle | null>(null);
  const paneRows = useRef<RowListHandle | null>(null);
  // The columns beside the frozen one, when they scroll sideways in their own pane, and how far.
  const paneScroll = { ref: useRef<unknown>(null), x: useRef(0) };
  const pageReveal = useContext(PageReveal);
  const groupTitle = view.group ? (fieldMap.get(view.group.field)?.title ?? view.group.field) : "";
  // Typed and shown against the grid as saved, so =C3 means the same row
  // whatever this reader's sort or search (D41).
  // (A Sheet view is never held in an index, so only rows in memory have a grid.)
  const grid = viewGrid(view, fields, indexed ? [] : inMemory.map((d) => d.row.id), sheet);
  // The cells the open formula reads, outlined: by row id, this row, or by place (D41).
  const inputCells = formulaCell
    ? formulaInputCells(openFormulaField, formulaCell.rowId, view, fields, sheet?.order)
    : barFormula
      ? formulaInputCells(fieldMap.get(barFormula.name), barFormula.rowId, view, fields, sheet?.order)
      : new Set<string>();
  // A formula being written in the outside editor: every row of its column
  // shows what the draft makes, once it compiles. The column is the preview.
  const barColumn = (() => {
    if (!barFormula) return null;
    const field = fieldMap.get(barFormula.name);
    const row = rowOf(barFormula.rowId);
    if (!field || !row) return null;
    const ex = explainFormula({
      field, row, fields: schema.fields, draft: barFormula.draft, editable: true,
      grid: grid ? { ...grid, here: barFormula.rowId } : undefined, allRows, computeOptions: { tables: relatedTables, self: tableKey },
    });
    const computed = ex.save?.computed;
    if (!computed) return null;
    const trial = schema.fields.map((f) => (f.name === field.name ? { ...f, computed } : f));
    const out = computeRows({ fields: trial }, allRows ?? rows, { tables: relatedTables, self: tableKey }).rows;
    return new Map(out.map((r) => [r.id, r[field.name]] as const));
  })();
  const canAddField = !!onAddField;
  // A new field lands at the end of the row, often past the right edge:
  // bring its header into view once it has rendered.
  const [addedField, setAddedField] = useState<string | null>(null);
  const addField = (field: Field) => {
    onAddField?.(field);
    setAddedField(field.name);
  };
  const addFieldButton = (compact: boolean) => (
    <Hinted hint="Add a field">
      <AddFieldButton
        compact={compact}
        hug={!compact}
        existingNames={new Set(schema.fields.map((f) => f.name))}
        fields={schema.fields}
        grid={grid}
        onAdd={addField}
      />
    </Hinted>
  );
  useEffect(() => {
    if (!addedField) return;
    const el = headerButtonRefs.current[addedField];
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
    setAddedField(null);
  }, [addedField, fields]);
  // Editors for the last columns on screen open back towards the table,
  // so they stay inside the window: leftwards in a left-to-right layout,
  // rightwards in a right-to-left one. On screen, not in the schema: a
  // view can hide or reorder fields, so the schema's last field may not
  // be the last shown.
  const opensTowardStart = (name: string) => fields.indexOf(name) >= Math.max(0, fields.length - 2);

  // Frozen primary column on the left, scrollable rest on the right —
  // useful on wide viewports for tables with many columns. On narrow
  // portrait viewports it ate too much real estate (the title column
  // is the widest), so default it off there: the table falls back to
  // a single horizontal scroll over all fields, primary included.
  const viewportWidth = useViewportWidth();
  const freezePrimary = viewportWidth > TOUCH_VIEWPORT_MAX;

  // Responsive cell width: cells fill the table's CONTAINER when
  // there's room (wide windows) and snap to MIN_CELL_WIDTH on narrow
  // viewports (mobile portrait), triggering horizontal scroll via the
  // consumer's ScrollView wrapper. Reactive via `useContainerWidth`
  // (web: ResizeObserver on the outer table div; native: RN onLayout).
  // Container-measured (not viewport-measured) so a sidebar-narrowed
  // main pane on web gets the right cell sizes, and an embedded
  // table inside a constrained panel does the right thing too.
  const { measureProps, width: containerWidth } = useContainerWidth();

  // Column-width model. The earlier version divided the container by
  // `fields + 1` (counting the "+ Field" slot) but then rendered that
  // slot at a FIXED width — so every row fell short of the container
  // by `cellWidth − ADD_FIELD_COLUMN_WIDTH`, leaving a dead strip on
  // the right (the "misaligned" look). Three corrections:
  //
  //   1. Divide by the DATA columns only (`fields.length`); the
  //      "+ Field" slot is a fixed-width reservation, not a 1/N share.
  //   2. Subtract that reservation (and the table's own 1px borders, +
  //      the frozen column's 1px divider) up front so the summed
  //      columns never exceed the content box and spawn a spurious
  //      horizontal scrollbar.
  //   3. Hand the `floor()` remainder out one pixel at a time to the
  //      leftmost columns so the columns sum EXACTLY to the available
  //      width — no hairline gap between the last cell and the border.
  //
  // The frozen-pane case needs no special math: the frozen column and
  // the scroll pane share the same global column order, so the per-
  // column widths still sum to the same total whether a column lives
  // left of the freeze line or right of it.
  //
  // Columns the user has resized keep their width; the rest share what's
  // left the same way.
  const chrome = (freezePrimary ? 3 : 2) + (coords ? ROW_NUMBER_WIDTH : 0);
  // "+ Field" sits under the table, not in a column of its own, so
  // it takes no width from the grid.
  const addFieldW = 0;
  const colWidth = columnWidths(fields, { ...(view.columnWidths ?? {}), ...liveWidths }, containerWidth, chrome + addFieldW);

  // A column's resize handle is on its end edge; in a right-to-left
  // layout that's the left, so dragging leftwards widens it.
  const widen = (start: { at: number }, pageX: number) => (rtl ? start.at - pageX : pageX - start.at);
  const columnResizer = (name: string) =>
    onUpdateView ? (
      <DragHandle
        edge="end"
        onDragStart={(e) => {
          resizeStart.current = { at: e.pageX, size: colWidth(name) };
        }}
        onDragMove={(e) => {
          const start = resizeStart.current;
          if (!start) return;
          const w = resizedColumnWidth(start.size, widen(start, e.pageX));
          setLiveWidths((prev) => ({ ...prev, [name]: w }));
        }}
        onDragEnd={(e) => {
          const start = resizeStart.current;
          resizeStart.current = null;
          if (!start) return;
          const w = resizedColumnWidth(start.size, widen(start, e.pageX));
          onUpdateView({ columnWidths: { ...(view.columnWidths ?? {}), [name]: w } });
          setLiveWidths({});
        }}
      />
    ) : null;

  // A row's grip: only on the row with the selected cell, so nothing else
  // can be dragged by a scroll that starts on a row's edge. A pill on the
  // row's bottom edge under the start of the selected cell, so it's in
  // view wherever the row has been scrolled, that takes a touch as it
  // lands. Dragging resizes the row in whole lines,
  // with a tick for each; a double tap fits it to what it holds.
  const rowGrip = (row: Row, cellStart: number) => {
    if (!onUpdateView) return null;
    const saveHeight = (h: number) => {
      if (h !== rowHeightOf(view, row.id)) onUpdateView({ rowHeights: { ...(view.rowHeights ?? {}), [row.id]: h } });
    };
    const dragging = liveRow?.rowId === row.id ? liveRow.h : null;
    return (
      <html.div style={[styles.rowGripSlot, styles.rowGripAt(cellStart + 4)]}>
        <DragHandle
          grabOnTouch
          onDragStart={(e) => {
            resizeStart.current = { at: e.pageY, size: heightOf(row.id) };
            lastStep.current = heightOf(row.id);
          }}
          onDragMove={(e) => {
            const start = resizeStart.current;
            if (!start) return;
            const h = snappedRowHeight(start.size, e.pageY - start.at);
            if (h !== lastStep.current) haptics.step?.();
            lastStep.current = h;
            setLiveRow({ rowId: row.id, h });
          }}
          onDragEnd={(e) => {
            const start = resizeStart.current;
            resizeStart.current = null;
            if (!start) return;
            saveHeight(snappedRowHeight(start.size, e.pageY - start.at));
            setLiveRow(null);
          }}
          onDoubleTap={() =>
            saveHeight(
              fittedRowHeight(
                fields.map((name) => ({
                  show: describeCell(fieldMap.get(name), row[name], display, relatedTables),
                  width: colWidth(name),
                })),
              ),
            )
          }
        >
          <html.div role="button" aria-label="Resize row" style={styles.rowGripHit}>
            <html.div style={styles.rowGrip}>
              <html.div style={styles.rowGripBar} />
              <html.div style={styles.rowGripBar} />
            </html.div>
          </html.div>
        </DragHandle>
        {dragging !== null && (
          <html.span style={styles.rowGripLabel}>
            {linesFor(dragging)} {linesFor(dragging) === 1 ? "line" : "lines"}
          </html.span>
        )}
      </html.div>
    );
  };

  // Where the selected cell starts in its pane: the grip sits under that
  // cell, so it's in view wherever the pane has been scrolled.
  const cellStartIn = (names: string[], name: string, numbered: boolean) => {
    let x = numbered ? ROW_NUMBER_WIDTH : 0;
    for (const n of names) {
      if (n === name) break;
      x += colWidth(n);
    }
    return x;
  };

  // Split fields into primary (frozen, leftmost) + rest (scrollable).
  // Primary is the title field — first in the visible order. Empty
  // tables (no fields) still render a placeholder header.
  // When the primary is frozen, the left pane gets it and the right
  // pane gets the rest. When not frozen, the right pane gets all
  // fields and the left pane is unused.
  const primaryName = freezePrimary ? fields[0] : undefined;
  // Tables are edge to edge, as the markdown library's are: the framed
  // grid rests on the page's margin and scrolls sideways over it to the
  // screen's edges (Bleed). With a pinned first column the frame stays
  // put and its other columns scroll inside it.
  const edgeToEdge = !primaryName;
  const restNames = freezePrimary ? fields.slice(1) : fields;

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
    const isLast = idxInPane === paneLen - 1;
    const hint = <FieldHint field={field} name={name} schema={schema} editable={schemaEditable} />;
    // The same facts as text, for the system tooltip where there's no rich one (macOS).
    const hintText = fieldHintText(fieldHint({ field, name, schema, editable: schemaEditable, formulaSyntax }));
    if (!schemaEditable) {
      return (
        <Hinted
          key={name}
          hint={hint}
          text={hintText}
          style={[
            styles.tableCell,
            styles.cellWidth(colWidth(name)),
            styles.tableHeaderCell,
            styles.positioned,
            cellAlignStyle(align),
            !isLast && styles.tableCellSeparator,
          ]}
        >
          {coords && <html.span style={[styles.columnLetter, Platform.OS !== "web" && styles.columnLetterStacked]}>{columnLetter(fields.indexOf(name))}</html.span>}
          {/* In a span: on native a bare string in a view isn't drawn (and is an error). */}
          <html.span>{field?.title ?? name}</html.span>
          {columnResizer(name)}
        </Hinted>
      );
    }
    return (
      <Hinted
        key={name}
        hint={isEditing ? null : hint}
        text={isEditing ? undefined : hintText}
        style={[
          styles.headerCellWrapper,
          styles.cellWidth(colWidth(name)),
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
          {coords && <html.span style={[styles.columnLetter, Platform.OS !== "web" && styles.columnLetterStacked]}>{columnLetter(fields.indexOf(name))}</html.span>}
          {/* In a span: on native a bare string in a view isn't drawn (and is an error). */}
          <html.span>{field?.title ?? name}</html.span>
        </html.button>
        {isEditing && field && anchorRect && (
          <SchemaFieldEditor
            // The field as the file has it. fieldMap's copy carries the
            // format it is *shown* with, which for a formula may be an
            // inherited currency (D33) — editing that would write the
            // inheritance down as the field's own format.
            field={schema.fields[fieldIndex] ?? field}
            fieldIndex={fieldIndex}
            totalFields={schema.fields.length}
            align={opensTowardStart(name) !== rtl ? "right" : "left"}
            anchorRect={anchorRect}
            onUpdate={(patch) => onUpdateField!(name, patch)}
            onAddEnumValue={(value) => onAddEnumValue!(name, value)}
            onRemoveEnumValue={onRemoveEnumValue ? (value) => onRemoveEnumValue(name, value) : undefined}
            onDelete={
              onDeleteField
                ? () => {
                    // The settings close first: the field they show is going.
                    setEditingFieldName(null);
                    setAnchorRect(null);
                    onDeleteField(name);
                  }
                : undefined
            }
            onMove={(delta) => onMoveField!(name, delta)}
            onCancel={
              onRestoreSchema
                ? () => {
                    if (schemaBefore.current) onRestoreSchema(schemaBefore.current);
                    setEditingFieldName(null);
                    setAnchorRect(null);
                  }
                : undefined
            }
            fields={schema.fields}
            grid={grid}
            onClose={() => {
              setEditingFieldName(null);
              setAnchorRect(null);
            }}
          />
        )}
        {columnResizer(name)}
      </Hinted>
    );
  };

  const renderTotalCell = (name: string, idxInPane: number, paneLen: number) => {
    const field = fieldMap.get(name);
    const kind = totals[name];
    const { value: shown, numeric } = kind
      ? indexed
        ? shownTotal(facts.totals[name], kind)
        : totalFor(rows, name, kind)
      : { value: undefined, numeric: false };
    const content = kind ? (
      <>
        <html.span style={styles.totalLabel}>{TOTAL_LABELS[kind]}</html.span>
        {numeric ? (
          <CellValue field={field} value={shown} relatedTables={relatedTables} lines={1} />
        ) : (
          <html.span>{String(shown ?? "")}</html.span>
        )}
      </>
    ) : onUpdateView ? (
      <html.span style={[styles.totalPlaceholder, !HOVERS && styles.shown]}>Calculate</html.span>
    ) : null;
    const cellStyle = [
      styles.tableCell,
      styles.cellWidth(colWidth(name)),
      cellAlignStyle(effectiveAlign(field)),
      idxInPane !== paneLen - 1 && !quietTotals && styles.tableCellSeparator,
      styles.totalCell,
    ];
    // On a phone the footer cell is itself the system's menu of totals, as a
    // choice cell is its menu of choices; elsewhere it opens the popover below.
    if (onUpdateView && TotalsSelect.opensFromTrigger) {
      return (
        <Select
          key={name}
          value={kind ?? ""}
          options={[{ value: "", label: "None" }, ...totalKindsFor(field).map((k) => ({ value: k, label: TOTAL_NAMES[k] }))]}
          onChange={(next) => chooseTotal(name, (next || null) as ViewTotal | null)}
          label={`Calculate ${field?.title ?? name}`}
          trigger={<html.div style={[...cellStyle, styles.totalCellFill]}>{content}</html.div>}
        />
      );
    }
    return (
      <html.div
        key={name}
        style={[
          styles.tableCell,
          styles.cellWidth(colWidth(name)),
          cellAlignStyle(effectiveAlign(field)),
          idxInPane !== paneLen - 1 && !quietTotals && styles.tableCellSeparator,
          styles.totalCell,
        ]}
        onClick={
          onUpdateView
            ? (e: { pageX: number; pageY: number }) =>
                // The menu is fixed to the window: page coordinates less the scroll.
                setTotalsMenu({
                  name,
                  x: e.pageX - (!hasWindowSize() ? 0 : window.scrollX),
                  y: e.pageY - (!hasWindowSize() ? 0 : window.scrollY),
                })
            : undefined
        }
      >
        {content}
      </html.div>
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
    const isLast = idxInPane === paneLen - 1;
    const isFormula = field?.computed !== undefined;
    const cellKey = `${row.id}\u0000${name}`;
    const inOpenColumn = formulaCell?.name === name || barFormula?.name === name;
    const isOpenCell = inOpenColumn && (formulaCell?.rowId ?? barFormula?.rowId) === row.id;
    const shownValue = barColumn && barFormula?.name === name ? barColumn.get(row.id) : row[name];
    const select = () => {
      // Writing a formula, a tap may add a reference instead.
      if (editor?.tapWhileEditing?.(row.id, name, coords && grid ? (coordinateOf(name, row.id, grid) ?? name) : name)) return;
      // A tap elsewhere ends the open edit, so the editor follows to the
      // cell tapped: what was typed saves first; a choice or a date has
      // saved already. (The session clears itself on saving: hold it.)
      const open = barSession.current;
      if (open) {
        const typed = barDraft?.text ?? barFormula?.draft;
        if (typed !== undefined) {
          const done = open.save(typed);
          if (!done.ok) return;
        }
        editor?.end(open.key);
        barSession.current = null;
        setBarDraft(null);
        setBarFormula(null);
      }
      setSel({ rowId: row.id, name });
      keysRef.current?.focus();
      // While editing, the next cell tapped opens for editing too, as a
      // spreadsheet keeps typing from cell to cell. Only selected, a tap
      // only selects, so the table can be browsed without a keyboard.
      if (open) beginBar(row.id, name);
    };
    const isInputCell = inputCells.has(cellKey);
    const isSelected = sel?.rowId === row.id && sel.name === name;
    const request = editReq?.rowId === row.id && editReq.name === name ? editReq.req : undefined;
    return (
      <html.div
        key={name}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(el: any) => {
          cellRefs.current[cellKey] = el;
        }}
        onClick={
          isFormula && editor
            ? () => {
                // With an outside editor the formula opens there, on a second tap.
                if (isSelected && !barFormula) beginBar(row.id, name);
                else select();
              }
            : isFormula
            ? async () => {
                setSel({ rowId: row.id, name });
                keysRef.current?.focus();
                if (isOpenCell) {
                  setFormulaCell(null);
                  return;
                }
                const rect = await measureAnchor(cellRefs.current[cellKey]);
                if (rect) setFormulaCell({ rowId: row.id, name, rect });
              }
            : select
        }
        style={[
          styles.tableCell,
          styles.cellWidth(colWidth(name)),
          cellAlignStyle(align),
          !isLast && styles.tableCellSeparator,
          isFormula && styles.formulaCellClickable,
          inOpenColumn && styles.formulaColumnTint,
          isInputCell && styles.formulaInputCell,
          isOpenCell && styles.formulaCellActive,
          isSelected && styles.cellSelected,
        ]}
      >
        <CellWidth.Provider value={colWidth(name) - 24}>
        {onUpdateRow ? (
          <EditableCell
            field={field}
            value={shownValue}
            onCommit={(next) => onUpdateRow(row.id, name, next)}
            relatedTables={relatedTables}
            onOpenRelation={onOpenRelation}
            lines={linesFor(heightOf(row.id))}
            align={align}
            autoEdit={row.id === focusRowId && name === (primaryName ?? restNames[0])}
            selected={isSelected}
            onSelect={select}
            onAttach={onAttachFile && field?.attachment ? () => onAttachFile(row.id, name) : undefined}
            editRequest={request}
            onEditHeard={editHeard}
            onEditEnd={endEdit(row.id, name)}
            editOutside={editor && !(editor.formulasOnly && !isFormula) ? (text) => beginBar(row.id, name, text) : undefined}
            outsideDraft={barDraft?.rowId === row.id && barDraft.name === name ? barDraft.text : undefined}
          />
        ) : (
          <CellValue
            field={field}
            value={shownValue}
            relatedTables={relatedTables}
            onOpenRelation={onOpenRelation}
            lines={linesFor(heightOf(row.id))}
          />
        )}
        </CellWidth.Provider>
        {name === titleField && bodies?.[row.id] ? (
          <BodyBadge onClick={onOpenBody ? () => onOpenBody(row.id) : undefined} />
        ) : null}
      </html.div>
    );
  };

  // ---- keyboard: a selected cell, moved and opened from the keyboard,
  // as Sheets and Airtable have it. Columns in display order, rows as shown.
  const lastRow = total - 1;

  // Where you are, for history: the cell selected, reported as it changes,
  // and put back when the view is gone back to.
  const placeReport = useRef(onPlace);
  placeReport.current = onPlace;
  useEffect(() => {
    placeReport.current?.(sel ? { rowId: sel.rowId, field: sel.name } : {});
    // Again for a new view: the app starts each view's place afresh.
  }, [sel?.rowId, sel?.name, view.id]);
  useEffect(() => {
    const p = restorePlace?.place;
    if (!p) return;
    if (p.rowId && p.field && (indexed || placeOfId(p.rowId) >= 0) && fields.includes(p.field)) setSel({ rowId: p.rowId, name: p.field });
    else setSel(null);
    // Each place once, as it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restorePlace?.n]);
  // How far down, as a row and an offset. Where the rows are a windowed list
  // (the web), a row's top is the list's top plus the heights before it, so
  // a row that isn't drawn has a place too. Elsewhere it's measured from the
  // rows' first cells, which run top to bottom, so a halving search needs few.
  const measureRows = useRef({ first: fields[0], total, layoutOf, placeOfId, idAt, source: given });
  measureRows.current = { first: fields[0], total, layoutOf, placeOfId, idAt, source: given };
  useEffect(() => {
    if (!onPlaceMeasure) return;
    const listTop = () => (paneRows.current ?? frozenRows.current)?.top() ?? null;
    const measured = async (rowId: string) => {
      const { first } = measureRows.current;
      const rect = first ? await measureAnchor(cellRefs.current[`${rowId}\u0000${first}`]) : null;
      return rect ? rect.top : null;
    };
    const topOf = async (rowId: string) => {
      const now = measureRows.current;
      const from = listTop();
      if (from === null) return measured(rowId);
      let at = now.placeOfId(rowId);
      // In an index, and not among the rows on screen: the index says where it is.
      if (at < 0 && now.source) at = await now.source.placeOf(rowId);
      return at < 0 ? null : from + now.layoutOf().topOf(at);
    };
    onPlaceMeasure({
      topOf,
      rowAt: async (y) => {
        const now = measureRows.current;
        if (now.total === 0) return null;
        const from = listTop();
        if (from !== null) {
          const layout = now.layoutOf();
          const at = Math.min(now.total - 1, layout.at(y - from));
          const rowId = now.idAt(at) ?? (now.source ? (await now.source.ids(at, at + 1))[0] : undefined);
          return rowId === undefined ? null : { rowId, offset: Math.round(y - (from + layout.topOf(at))) };
        }
        let lo = 0;
        let hi = now.total - 1;
        let found: { rowId: string; offset: number } | null = null;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const rowId = now.idAt(mid);
          const top = rowId === undefined ? null : await measured(rowId);
          if (rowId === undefined || top === null) return found;
          if (top <= y) {
            found = { rowId, offset: Math.round(y - top) };
            lo = mid + 1;
          } else hi = mid - 1;
        }
        const firstId = now.idAt(0);
        return found ?? (firstId ? { rowId: firstId, offset: 0 } : null);
      },
    });
    return () => onPlaceMeasure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPlaceMeasure]);
  const lastCol = fields.length - 1;
  // A place to select once its row has arrived from the index.
  const selectWhenHere = useRef<{ place: number; name: string } | null>(null);
  /** Select the cell at a place, wherever it is: a row of an index that isn't here yet is gone to, and selected as it arrives. */
  const selectAt = (r: number, c: number) => {
    const place = Math.max(0, Math.min(lastRow, r));
    const name = fields[Math.max(0, Math.min(lastCol, c))]!;
    const rowId = idAt(place);
    if (rowId !== undefined) return setSel({ rowId, name });
    if (!indexed || total === 0) return;
    selectWhenHere.current = { place, name };
    paneRows.current?.scrollIndexIntoView(place);
    frozenRows.current?.scrollIndexIntoView(place);
  };
  useEffect(() => {
    const wanted = selectWhenHere.current;
    const rowId = wanted ? idAt(wanted.place) : undefined;
    if (!wanted || rowId === undefined) return;
    selectWhenHere.current = null;
    setSel({ rowId, name: wanted.name });
  });
  const editable = (name: string) => !!onUpdateRow && fieldMap.get(name)?.computed === undefined;
  /**
   * Hand a cell's edit to the outside editor (#352). A formula column's
   * formula, a value typed, or a choice picked; anything else (a toggle,
   * a list, a date with its picker, a file) stays in the cell. False when
   * there is no editor or it doesn't take this cell.
   */
  const beginBar = (rowId: string, name: string, text?: string): boolean => {
    if (!editor) return false;
    const field = fieldMap.get(name);
    const row = rowOf(rowId);
    if (!field || !row) return false;
    const label = field.title ?? field.name;
    const rowLabel = titleField ? formatValue(row[titleField]) : row.id;
    const key = `${rowId}\u0000${name}\u0000${++barSeq.current}`;
    let session: CellEditSession;
    if (field.computed) {
      if (!schemaEditable) return false;
      const g = grid ? { ...grid, here: rowId } : undefined;
      const explain = (draft: string) =>
        explainFormula({ field, row, fields: schema.fields, draft, editable: true, grid: g, allRows, computeOptions: { tables: relatedTables, self: tableKey } });
      const initial = formulaDraftOf(field, g, formulaSyntax);
      setFormulaCell(null);
      setBarFormula({ rowId, name, draft: initial });
      session = {
        key, rowId, name, rowLabel, initial,
        label: `ƒ ${label} · every row`,
        mode: "formula",
        suggestions: false,
        change: (t) => {
          setBarFormula({ rowId, name, draft: t });
          const ex = explain(t);
          if (ex.status?.kind === "error") {
            const open = (t.match(/\(/g) ?? []).length - (t.match(/\)/g) ?? []).length;
            return { error: { message: ex.status.message, fix: open > 0 ? ")" : undefined } };
          }
          return { result: formatCellValue(field, ex.preview ? ex.preview.value : row[name]) };
        },
        // The web panel's working, as text: each input as its cell shows it.
        details: (t) => {
          const ex = explain(t);
          const shown = (i: { field: string; value: unknown }) => {
            const f = fieldMap.get(i.field);
            return f ? formatCellValue(f, i.value) : i.value == null ? "" : String(i.value);
          };
          return {
            thisRow: ex.thisRow.map((i) => ({ label: i.label, shown: shown(i) })),
            otherRows: ex.otherRows.map((i) => ({ label: i.label, shown: shown(i) })),
            result: formatCellValue(field, row[name]),
            ...(ex.changed && ex.preview ? { after: formatCellValue(field, ex.preview.value) } : {}),
          };
        },
        save: (t) => {
          const ex = explain(t);
          if (ex.status?.kind === "error") return { ok: false, error: { message: ex.status.message } };
          if (ex.save) onUpdateField!(name, ex.save);
          setBarFormula(null);
          barSession.current = null;
          return { ok: true };
        },
        cancel: () => {
          setBarFormula(null);
          barSession.current = null;
        },
        next: () => {},
      };
    } else {
      if (!editable(name)) return false;
      const kind = editorKind(field);
      const hints = inputHints(field);
      const many = kind === "list" && enumOptions(field).length > 0;
      // A link to rows: its choices are the linked table's rows.
      const linked = kind === "relation" ? relationOptions(field, relatedTables) : [];
      const linksMany = linked.length > 0 && relatesMany(field);
      const linksOne = linked.length > 0 && !linksMany;
      const dated = hints.kind === "date" || hints.kind === "time" || hints.kind === "datetime";
      if (kind !== "text" && kind !== "choice" && !many && !linksOne && !linksMany) return false;
      const initial = text ?? draftOf(row[name]);
      // A draft already asked about (an early year): Return again keeps it.
      let queried: string | null = null;
      // A multi-select's value as it's toggled, each toggle saved.
      let current: unknown = row[name];
      // Typed values show as they're typed; a choice keeps its pill until it's picked.
      if (kind === "text" && !dated) setBarDraft({ rowId, name, text: initial });
      session = {
        key, rowId, name, label, rowLabel, initial,
        mode: field.format === "markdown" ? "text" : "line",
        // The keyboard the field wants, as a cell's own input has (inputHints).
        keyboard: BAR_KEYBOARD[hints.kind] ?? "default",
        suggestions: hints.autocorrect,
        ...(kind === "text" && !dated && currencySymbolOf(field) ? { prefix: currencySymbolOf(field)! } : {}),
        ...(kind === "choice" || many
          ? {
              choices: enumOptions(field).map((o) => ({ id: o.value, label: o.label ?? o.value, colors: pillColors(o.color) })),
              ...(onAddEnumValue
                ? {
                    addChoice: (label: string) => {
                      const value = label.trim();
                      if (!value) return;
                      if (!enumOptions(field).some((o) => o.value === value)) onAddEnumValue(name, value);
                      if (many) {
                        current = listToggled({ ...field, constraints: { ...field.constraints, enum: [...(field.constraints?.enum ?? []), value] } }, current, value);
                        onUpdateRow!(rowId, name, current);
                      } else onUpdateRow!(rowId, name, value);
                    },
                  }
                : {}),
            }
          : {}),
        ...(kind === "choice" || linksOne ? { selected: typeof row[name] === "string" ? (row[name] as string) : undefined } : {}),
        ...(linksOne || linksMany ? { choices: linked.map((o) => ({ id: o.value, label: o.label })) } : {}),
        ...(linksMany
          ? {
              multiple: true,
              selectedMany: listItems(row[name]),
              toggle: (id: string) => {
                current = relationToggled(field, current, id, relatedTables);
                onUpdateRow!(rowId, name, current);
                return listItems(current);
              },
            }
          : {}),
        ...(many
          ? {
              multiple: true,
              selectedMany: listItems(row[name]),
              toggle: (id: string) => {
                current = listToggled(field, current, id);
                onUpdateRow!(rowId, name, current);
                return listItems(current);
              },
            }
          : {}),
        ...(dated
          ? {
              date: {
                value: dateOfDraft(draftOf(row[name]), hints.kind),
                components: hints.kind === "date" ? ["date" as const] : hints.kind === "time" ? ["hourAndMinute" as const] : ["date" as const, "hourAndMinute" as const],
                shown: formatCellValue(field, row[name]),
                pick: (d: Date) => {
                  const r = commitDraft(field, current, draftOfDate(d, hints.kind), "key", null);
                  if (r.kind === "problem") return { ok: false as const, error: { message: r.check.message } };
                  if (r.kind === "save") {
                    current = r.value;
                    onUpdateRow!(rowId, name, r.value);
                  }
                  return { ok: true as const, shown: formatCellValue(field, current) };
                },
              },
            }
          : {}),
        change: (t) => {
          setBarDraft({ rowId, name, text: t });
          return {};
        },
        save: (t) => {
          if (linksOne) {
            setBarDraft(null);
            barSession.current = null;
            if (t !== row[name]) onUpdateRow!(rowId, name, t);
            return { ok: true };
          }
          const r = commitDraft(field, row[name], t, "key", queried);
          if (r.kind === "problem") {
            queried = r.queried;
            return { ok: false, error: { message: r.check.message, ...(r.check.suggestion ? { replace: r.check.suggestion } : {}) } };
          }
          setBarDraft(null);
          barSession.current = null;
          if (r.kind === "save") onUpdateRow!(rowId, name, r.value);
          return { ok: true };
        },
        // Emptied as the Delete key does (the value goes, not ""), required or not:
        // the table then reports a required one as missing, as on the web.
        ...((kind === "choice" && !many) || linksOne || dated
          ? {
              clear: () => {
                setBarDraft(null);
                barSession.current = null;
                if (row[name] !== undefined) onUpdateRow!(rowId, name, undefined);
              },
            }
          : {}),
        cancel: () => {
          setBarDraft(null);
          barSession.current = null;
        },
        // Return: down a row, still editing, as a spreadsheet does.
        next: () => {
          const below = idAt(placeOfId(rowId) + 1);
          setSel({ rowId: below ?? rowId, name });
          if (below) beginBar(below, name);
        },
      };
    }
    if (!editor.begin(session)) {
      setBarDraft(null);
      setBarFormula(null);
      return false;
    }
    barSession.current = session;
    setSel({ rowId, name });
    // Keep it in view above the editor (and the keyboard).
    void measureAnchor(cellRefs.current[`${rowId}\u0000${name}`]).then((rect) => rect && editor.reveal?.(rect));
    return true;
  };

  const openCell = async (rowId: string, name: string, text?: string) => {
    if (beginBar(rowId, name, text)) return;
    const field = fieldMap.get(name);
    if (field?.computed) {
      // A formula cell opens its formula, as a click does.
      const rect = await measureAnchor(cellRefs.current[`${rowId}\u0000${name}`]);
      if (rect) setFormulaCell({ rowId, name, rect });
      return;
    }
    if (!editable(name)) return;
    if (field?.type === "boolean") {
      const row = rowOf(rowId);
      onUpdateRow!(rowId, name, !(row?.[name] === true));
      return;
    }
    setEditReq({ rowId, name, req: { n: Date.now(), text } });
  };
  // Where the selection goes when editing ends from the keyboard; the
  // table takes the keyboard back either way.
  const endEdit = (rowId: string, name: string) => (how: EditEnd) => {
    const next = afterEdit({ row: placeOfId(rowId), col: fields.indexOf(name) }, how, total, fields.length);
    selectAt(next.row, next.col);
    gridRef.current?.focus?.({ preventScroll: true });
    keysRef.current?.focus();
  };
  const onGridKey = (e: KeyEventLike) => {
    const tag = (e.target as { tagName?: string } | undefined)?.tagName;
    // Typing in a cell editor, a picker or a header button is theirs.
    if (tag && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag)) return;
    const cur = sel && placeOfId(sel.rowId) >= 0 && fields.includes(sel.name) ? sel : null;
    const field = cur ? fieldMap.get(cur.name) : undefined;
    // What the key does is table-ui/shared's gridKey, as table-gtk's grid has it.
    const action = gridKey(
      cur ? { row: placeOfId(cur.rowId), col: fields.indexOf(cur.name) } : null,
      total,
      fields.length,
      { key: e.key, shift: e.shiftKey, jump: e.metaKey || e.ctrlKey, alt: e.altKey },
      { editable: !!cur && editable(cur.name), boolean: field?.type === "boolean", picks: cellPicks(field), computed: !!field?.computed },
    );
    if (!action || action.kind === "leave") return;
    if (action.kind === "deselect") return setSel(null);
    e.preventDefault?.();
    if (action.kind === "select") return selectAt(action.at.row, action.at.col);
    if (!cur) return;
    if (action.kind === "clear") return onUpdateRow!(cur.rowId, cur.name, undefined);
    void openCell(cur.rowId, cur.name, action.kind === "open" ? action.text : undefined);
  };
  // Focus leaving the table (not moving within it) drops the selection.
  // The browser's own focusout: RSD's blur event doesn't say where focus went.
  useEffect(() => {
    const el = gridRef.current;
    if (!el?.addEventListener) return;
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !el.contains(next)) setSel(null);
    };
    el.addEventListener("focusout", onOut);
    return () => el.removeEventListener("focusout", onOut);
  }, []);
  useEffect(() => {
    if (!sel) return;
    const cell = cellRefs.current[`${sel.rowId}\u0000${sel.name}`];
    if (cell?.scrollIntoView) {
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    if (cell) {
      // Native has no scrollIntoView: the columns' own pane scrolls sideways
      // here, and the page, which the app scrolls, is asked for the rest.
      void measureAnchor(cell).then(async (rect) => {
        if (!rect) return;
        const pane = sel.name === primaryName ? null : await measureAnchor(paneScroll.ref.current);
        if (pane) {
          const margin = 8;
          const dx =
            rect.left < pane.left
              ? rect.left - pane.left - margin
              : rect.left + rect.width > pane.left + pane.width
                ? rect.left + rect.width - (pane.left + pane.width) + margin
                : 0;
          if (dx !== 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (paneScroll.ref.current as any)?.scrollTo?.({ x: Math.max(0, paneScroll.x.current + dx), animated: false });
          }
        }
        pageReveal?.(rect);
      });
      return;
    }
    // Off screen, the row isn't drawn and has no cell to scroll to: ask the
    // list. Both panes follow one scroller, so either list will do.
    const at = placeOfId(sel.rowId);
    if (at >= 0) paneRows.current?.scrollIndexIntoView(at);
    // In an index and not on screen: it says where the row is.
    else if (given) void Promise.resolve(given.placeOf(sel.rowId)).then((place) => place >= 0 && paneRows.current?.scrollIndexIntoView(place));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  // "+ New row", in the table under the last row, as Notion and Airtable
  // have it. It spans both panes at one height so they stay level; the
  // pane with the first column carries the label, and either half adds.
  const newRowBand = (labelled: boolean) => (
    <html.div
      role="button"
      onClick={addRow}
      onPointerEnter={() => setNewRowHot(true)}
      onPointerLeave={() => setNewRowHot(false)}
      style={[styles.tableRow, styles.newRow, newRowHot && styles.newRowHot, !showTotals && styles.tableRowLast]}
    >
      {labelled && (
        <Hinted
          hint={
            "Add a row and start typing in it. A view's filter may hide it until it's filled in." +
            (onDeleteRow && RowActions.gesture ? `\n${RowActions.gesture} to delete it.` : "")
          }
        >
          <html.span style={styles.newRowLabel}>+ New row</html.span>
        </Hinted>
      )}
    </html.div>
  );

  return (
    <>
    {/* "+" for a new field sits at the end of the header row, just outside
        the table, as Airtable has it: the grid gives up its width once,
        rather than every row carrying an empty column (#71). */}
    {edgeToEdge && (
      <html.div aria-hidden={true} style={[styles.tableWithAdd, styles.measureRow]}>
        <html.div {...measureProps} style={styles.tableGrow} />
      </html.div>
    )}
    <EdgeToEdge on={edgeToEdge}>
    <GridKeys ref={keysRef} onKeyDown={onGridKey}>
    <html.div
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={(el: any) => {
        gridRef.current = el;
      }}
      tabIndex={0}
      onKeyDown={onGridKey}
      style={[styles.tableWithAdd, edgeToEdge && styles.tableFit]}
    >
    <html.div {...(edgeToEdge ? {} : measureProps)} style={[styles.table, edgeToEdge ? styles.tableFit : styles.tableGrow]}>
      <html.div style={styles.tablePanes}>
        {/* Frozen pane: primary (title) field — header + one cell per row,
            stacked vertically. The primary stays put while the user pans
            the rest pane horizontally. Omitted entirely on narrow
            viewports — the right pane then carries all fields. */}
        {primaryName && (
          <html.div style={styles.tableFrozenColumn}>
            <html.div style={[styles.tableRow, styles.tableHeaderRow]}>
              {coords && <html.div style={[styles.rowNumber, styles.rowNumberCorner]} />}
              {renderHeaderCell(primaryName, 0, 1)}
            </html.div>
            <RowList
              items={places}
              keyOf={rowKeyOf}
              sizeOf={rowItemHeight}
              version={rowsVersion}
              raised={rowRaised}
              handle={frozenRows}
              layout={tallLayout}
              render={(place) => drawn(place, ({ row, starts }, i) => (
                <>
                  {starts && (
                    <html.div style={[styles.tableRow, styles.groupRow]}>
                      <html.span style={styles.groupLabel}>
                        {groupTitle} · {starts.label}
                        <html.span style={styles.groupCount}>{`${SPAN_GAP}${starts.count}`}</html.span>
                      </html.span>
                    </html.div>
                  )}
                  <RowActions actions={actionsFor(row.id)} title={titleField ? formatValue(row[titleField]) : undefined}>
                    <html.div
                      style={[
                        styles.tableRow,
                        styles.rowHeight(heightOf(row.id)),
                        styles.positioned,
                        i === total - 1 && !onAddRow && styles.tableRowLast,
                      ]}
                    >
                      {coords && <html.div style={styles.rowNumber}><html.span>{rowNumber(sheet?.position, row.id, i)}</html.span></html.div>}
                      {renderBodyCell(row, primaryName, 0, 1)}
                    </html.div>
                  </RowActions>
                  {sel?.rowId === row.id && sel.name === primaryName && (
                    <html.div style={styles.rowGripAnchor}>{rowGrip(row, cellStartIn([primaryName], primaryName, !!coords))}</html.div>
                  )}
                </>
              ))}
            />
            {addRow && newRowBand(true)}
            {showTotals && (
              <html.div style={[styles.tableRow, styles.totalsRow, quietTotals && styles.totalsRowQuiet]}>
                {coords && <html.div style={[styles.rowNumber, styles.rowNumberCorner]} />}
                {renderTotalCell(primaryName, 0, 1)}
              </html.div>
            )}
          </html.div>
        )}
        {/* Scrollable pane: everything past the primary field, plus the
            `+ Field` affordance. Renders inside HScroll which delivers a
            horizontal scrollbar on web and an RN ScrollView on native. */}
        <html.div style={edgeToEdge ? styles.tablePaneFit : styles.tableScrollOuter}>
          <PaneScroll on={!edgeToEdge} scroll={paneScroll}>
            <html.div style={edgeToEdge ? styles.tablePaneFit : styles.tableScrollPane}>
              <html.div style={[styles.tableRow, styles.tableHeaderRow]}>
                {coords && !primaryName && <html.div style={[styles.rowNumber, styles.rowNumberCorner]} />}
                {restNames.map((name, idx) =>
                  renderHeaderCell(name, idx, restNames.length),
                )}
              </html.div>
              <RowList
                items={places}
                keyOf={rowKeyOf}
                sizeOf={rowItemHeight}
                version={rowsVersion}
                raised={rowRaised}
                handle={paneRows}
                layout={tallLayout}
                onShown={onShown}
                render={(place) => drawn(place, ({ row, starts }, i) => (
                  <>
                    {starts && (
                      // The frozen pane labels the group; this pane's band
                      // matches its height so the rows stay in line.
                      <html.div style={[styles.tableRow, styles.groupRow]}>
                        {!primaryName && (
                          <html.span style={styles.groupLabel}>
                            {groupTitle} · {starts.label}
                            <html.span style={styles.groupCount}>{`${SPAN_GAP}${starts.count}`}</html.span>
                          </html.span>
                        )}
                      </html.div>
                    )}
                    <RowActions actions={actionsFor(row.id)} title={titleField ? formatValue(row[titleField]) : undefined}>
                      <html.div
                        style={[
                          styles.tableRow,
                          styles.rowHeight(heightOf(row.id)),
                          styles.positioned,
                            i === total - 1 && !onAddRow && styles.tableRowLast,
                        ]}
                      >
                        {coords && !primaryName && <html.div style={styles.rowNumber}><html.span>{rowNumber(sheet?.position, row.id, i)}</html.span></html.div>}
                        {restNames.map((name, idx) =>
                          renderBodyCell(row, name, idx, restNames.length),
                        )}
                      </html.div>
                    </RowActions>
                    {sel?.rowId === row.id && sel.name !== primaryName && (
                      <html.div style={styles.rowGripAnchor}>
                        {rowGrip(row, cellStartIn(restNames, sel.name, !!coords && !primaryName))}
                      </html.div>
                    )}
                  </>
                ))}
              />
              {addRow && newRowBand(!primaryName)}
              {showTotals && (
                <html.div style={[styles.tableRow, styles.totalsRow, quietTotals && styles.totalsRowQuiet]}>
                  {coords && !primaryName && <html.div style={[styles.rowNumber, styles.rowNumberCorner]} />}
                  {restNames.map((name, idx) => renderTotalCell(name, idx, restNames.length))}
                </html.div>
              )}
            </html.div>
          </PaneScroll>
        </html.div>
      </html.div>
    </html.div>
      {canAddField && !edgeToEdge && (
        <html.div style={styles.addFieldSlot}>{addFieldButton(true)}</html.div>
      )}
    </html.div>
    </GridKeys>
    </EdgeToEdge>
    {/* Edge to edge, the grid keeps all the width and "+ Field" sits under
        it, on the page's margin, rather than taking a strip beside it. */}
    {canAddField && edgeToEdge && <html.div style={styles.addFieldBelow}>{addFieldButton(false)}</html.div>}
      {formulaCell && openFormulaField && (() => {
        const openRow = rowOf(formulaCell.rowId);
        if (!openRow) return null;
        const name = formulaCell.name;
        return (
          <FormulaCellPanel
            // A fresh draft for each cell opened — never another column's.
            key={`${formulaCell.rowId}\u0000${name}`}
            field={schema.fields.find((f) => f.name === name) ?? openFormulaField}
            row={openRow}
            fields={schema.fields}
            anchorRect={formulaCell.rect}
            renderValue={(fieldName, value) => (
              <CellValue
                field={fieldMap.get(fieldName)}
                value={value}
                relatedTables={relatedTables}
                lines={1}
              />
            )}
            onSave={schemaEditable ? (patch) => onUpdateField!(name, patch) : undefined}
            // The cell under a click, named as a tap names it on iOS: its
            // coordinate in a sheet, else its column. Only a page has points.
            referenceAt={
              typeof document === "undefined"
                ? undefined
                : (x, y) => {
                    const under = document.elementsFromPoint(x, y);
                    for (const [key, node] of Object.entries(cellRefs.current)) {
                      if (!node || !under.some((el) => node === el || (node as Element).contains?.(el))) continue;
                      const [rowId, field] = key.split("\u0000") as [string, string];
                      return coords && grid ? (coordinateOf(field, rowId, grid) ?? field) : field;
                    }
                    return null;
                  }
            }
            onMoreOptions={
              schemaEditable
                ? async () => {
                    setFormulaCell(null);
                    const rect = await measureAnchor(headerButtonRefs.current[name]);
                    if (rect) setAnchorRect(rect);
                    setEditingFieldName(name);
                  }
                : undefined
            }
            onClose={() => setFormulaCell(null)}
            grid={grid ? { ...grid, here: formulaCell.rowId } : undefined}
            allRows={allRows}
            computeOptions={{ tables: relatedTables, self: tableKey }}
          />
        );
      })()}
      {totalsMenu && onUpdateView && (() => {
        const kinds = totalKindsFor(fieldMap.get(totalsMenu.name));
        const choose = (kind: ViewTotal | null) => chooseTotal(totalsMenu.name, kind);
        return (
          <Portal>
            <html.div style={styles.rowMenuBackdrop} onClick={() => setTotalsMenu(null)} />
            <html.div
              role="menu"
              style={[
                styles.rowMenu,
                styles.rowMenuAt(
                  !hasWindowSize() ? totalsMenu.y : Math.min(totalsMenu.y, window.innerHeight - 40 * (kinds.length + 1)),
                  !hasWindowSize() ? totalsMenu.x : Math.min(totalsMenu.x, window.innerWidth - 190),
                ),
              ]}
            >
              <html.button role="menuitem" style={styles.rowMenuItem} onClick={() => choose(null)}>
                None
              </html.button>
              {kinds.map((k) => (
                <html.button key={k} role="menuitem" style={styles.rowMenuItem} onClick={() => choose(k)}>
                  {TOTAL_NAMES[k]}
                </html.button>
              ))}
            </html.div>
          </Portal>
        );
      })()}
    </>
  );
}

/**
 * Keyboard focus for the views that show rows as cards: one card has a
 * ring, arrows move it (`move` says where), Enter opens the card's
 * page, and Escape, or focus leaving the view, drops it. `onAltKey`
 * takes Option/Alt+arrow first (moving a card), returning whether it did.
 */
function useCardKeys({
  move,
  firstId,
  onOpen,
  onAltKey,
}: {
  move: (id: string, key: string) => string;
  firstId: string | undefined;
  onOpen?: (id: string) => void;
  onAltKey?: (id: string, key: string) => boolean;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardRefs = useRef<Record<string, any>>({});
  // The container can change (a board becomes a carousel on a phone), so
  // its focusout listener follows it: the browser's own event, as RSD's
  // blur doesn't say where focus went.
  const unbind = useRef<(() => void) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerRef = (el: any) => {
    unbind.current?.();
    unbind.current = null;
    if (!el?.addEventListener) return;
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !el.contains(next)) setFocusId(null);
    };
    el.addEventListener("focusout", onOut);
    unbind.current = () => el.removeEventListener("focusout", onOut);
  };
  useEffect(() => {
    if (focusId) cardRefs.current[focusId]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusId]);
  const onKeyDown = (e: KeyEventLike) => {
    const tag = (e.target as { tagName?: string } | undefined)?.tagName;
    if (tag && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag)) return;
    if (!focusId) {
      if (firstId && /^(Arrow|Home$|End$)/.test(e.key)) {
        e.preventDefault?.();
        setFocusId(firstId);
      }
      return;
    }
    if (e.altKey && onAltKey?.(focusId, e.key)) {
      e.preventDefault?.();
      return;
    }
    if (e.key === "Enter") {
      if (onOpen) {
        e.preventDefault?.();
        onOpen(focusId);
      }
      return;
    }
    if (e.key === "Escape") {
      setFocusId(null);
      return;
    }
    if (/^(Arrow|Home$|End$)/.test(e.key)) {
      e.preventDefault?.();
      setFocusId(move(focusId, e.key));
    }
  };
  return {
    focusId,
    setFocusId,
    containerProps: { ref: containerRef, tabIndex: 0 as const, onKeyDown },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cardRef: (id: string) => (el: any) => {
      cardRefs.current[id] = el;
    },
  };
}

export function BoardView({
  view,
  rows,
  schema,
  bodies,
  onUpdateRow,
  onUpdateView,
  onOpenBody,
  relatedTables,
  onOpenRelation,
}: ViewProps) {
  const board = boardColumns(view, rows, schema);
  const groupField = board.field;
  const fields = cardFields(view, schema, groupField);
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
  // Cards are drop targets too, so a card lands where it's dropped
  // within a column — before or after the card under the pointer —
  // not only at the end.
  const {
    register: registerCard,
    hitTest: hitTestCard,
    remeasure: remeasureCards,
    rectOf: cardRect,
  } = useDropTargets<string>();
  const [dropSlot, setDropSlot] = useState<{ id: string; after: boolean } | null>(null);

  // After a row's group field changes (card moved between columns),
  // the columns can resize / shift — refresh the rect cache so the
  // next drag's hit-test reflects the new layout. Same pattern as
  // ListView; see the comment there for the bug it fixes.
  useEffect(() => {
    remeasureColumns();
    remeasureCards();
  }, [rows, remeasureColumns, remeasureCards]);

  /** The card slot under the pointer, if it's in `column` and isn't the dragged card. */
  const slotAt = (x: number, y: number, column: string | null, dragged: string) => {
    if (!column) return null;
    const id = hitTestCard(x, y);
    if (!id || id === dragged) return null;
    const target = rows.find((r) => r.id === id);
    const key = target ? columnOf(target, groupField) : null;
    if (key !== column) return null;
    const r = cardRect(id);
    return { id, after: r ? y > r.y + r.height / 2 : false };
  };

  /** The whole view's row order with `dragged` moved into `column` at `slot`. */
  const orderAfterDropHere = (dragged: string, column: string, slot: { id: string; after: boolean } | null) =>
    orderAfterDrop(rows, board, dragged, column, slot);

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
  // Every choice is a column, even an empty one, so a card can be
  // dropped into it (boardColumns).
  const groups = board.groups;
  const columnKeys = board.keys;

  const cardColumns = columnKeys.map((k) => (groups[k] ?? []).map((r) => r.id));
  const cards = useCardKeys({
    move: (id, key) => moveInColumns(cardColumns, id, key),
    firstId: cardColumns.find((col) => col.length > 0)?.[0],
    onOpen: onOpenBody,
    // Option/Alt+←→ moves the card to the next column, Option/Alt+↑↓
    // within its column: what dragging does, from the keyboard.
    onAltKey: (id, key) => {
      if (!onUpdateRow || !/^Arrow/.test(key) || (!onUpdateView && (key === "ArrowUp" || key === "ArrowDown"))) return false;
      const moved = boardCardMove(cardColumns, columnKeys, id, key);
      if (moved?.kind === "column") onUpdateRow(id, groupField, columnValue(moved.column));
      if (moved?.kind === "swap") onUpdateView?.({ order: orderSwapped(rows, id, moved.with) });
      return true;
    },
  });

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
          <BoardColumnTitle field={schema.fields.find((f) => f.name === groupField)} value={key} />
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
                    const slot = slotAt(e.pageX, e.pageY, hit, row.id);
                    setDropSlot((prev) =>
                      prev?.id === slot?.id && prev?.after === slot?.after ? prev : slot,
                    );
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
                        onUpdateRow(row.id, groupField, columnValue(target));
                      }
                      // Where in the column: saved as the view's manual
                      // order, as the list does (SPEC section 4, `order`).
                      if (onUpdateView) {
                        const slot = slotAt(e.pageX, e.pageY, target, row.id);
                        onUpdateView({ order: orderAfterDropHere(row.id, target, slot) });
                      }
                    }
                    setDraggedRowId(null);
                    setHoveredColumn(null);
                    setPointerPos(null);
                    setDropSlot(null);
                  }
                : undefined
            }
          >
            <html.div
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ref={(el: any) => {
                cards.cardRef(row.id)(el);
                if (canDrag) registerCard(row.id).ref(el);
              }}
              onClick={() => {
                cards.setFocusId(row.id);
                onOpenBody?.(row.id);
              }}
              style={[
                styles.boardCardWrapper,
                canDrag && styles.draggableHandle,
                cards.focusId === row.id && styles.cardFocused,
                draggedRowId === row.id && styles.cardDragging,
                dropSlot?.id === row.id && (dropSlot.after ? styles.dropAfter : styles.dropBefore),
              ]}
            >
              <Card
                row={row}
                fields={fields}
                fieldMap={fieldMap}
                relatedTables={relatedTables}
                onOpenRelation={onOpenRelation}
                hasBody={!!bodies?.[row.id]}
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
  // Either way the columns run to the page's edges as they scroll (Bleed),
  // starting and ending in line with the page (GutterSpacer).
  if (isTouchViewport) {
    // Each column is a snap point of its own, so the carousel pages one
    // column at a time and rests wherever it's swiped to.
    return (
      <>
        <html.div {...cards.containerProps}>
          <Bleed>
            <SnapHScroll snapInterval={carouselSnapInterval} gap={BOARD_GAP}>
              {columnsContent}
            </SnapHScroll>
          </Bleed>
        </html.div>
        {ghost}
      </>
    );
  }
  return (
    <>
      <Bleed>
        <html.div {...cards.containerProps} style={styles.board}>
          <GutterSpacer gap={BOARD_GAP} />
          {columnsContent}
          <GutterSpacer gap={BOARD_GAP} />
        </html.div>
      </Bleed>
      {ghost}
    </>
  );
}


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
  const fields = cardFields(view, schema, galleryField);
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
  const { perRow: cardsPerRow, cardWidth } = galleryLayout(containerWidth);

  const ids = rows.map((r) => r.id);
  const cards = useCardKeys({
    move: (id, key) => moveInGrid(ids, cardsPerRow, id, key),
    firstId: ids[0],
    onOpen: onOpenBody,
  });
  return (
    <html.div
      {...measureProps}
      {...cards.containerProps}
      // Both want the element: the width measure and the keyboard.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={(el: any) => {
        cards.containerProps.ref(el);
        measureProps.ref?.(el);
      }}
      style={styles.gallery}
    >
      {rows.map((row) => {
        const excerpt = bodyExcerpt(bodies?.[row.id]);
        const hasBody = !!bodies?.[row.id];
        return (
          <html.div
            key={row.id}
            ref={cards.cardRef(row.id)}
            onClick={() => cards.setFocusId(row.id)}
            style={[
              styles.card,
              styles.galleryCard,
              styles.cellWidth(cardWidth),
              cards.focusId === row.id && styles.cardFocused,
            ]}
          >
            {galleryField && (
              <GalleryHero field={fieldMap.get(galleryField)} value={row[galleryField]} />
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

  // After a reorder, rows shift to new screen positions but the same
  // React elements are reused (keyed by row.id). Refs don't re-fire,
  // so the rect cache holds the previous-frame positions — a tap on
  // a just-moved row hit-tests against the row that's NOW where it
  // used to be, committing another one-slot reorder. Trigger an
  // explicit remeasure whenever the `rows` array identity changes.
  useEffect(() => {
    remeasureRows();
  }, [rows, remeasureRows]);

  const computeOrder = (draggedId: string, targetRowId: string): string[] => orderMovedTo(rows, draggedId, targetRowId);

  const listed = groupedRows(view, rows, schema);
  const cards = useCardKeys({
    move: (id, key) => moveInColumns([listed.map((d) => d.row.id)], id, key),
    firstId: listed[0]?.row.id,
    onOpen: onOpenBody,
    // Option/Alt+↑↓ moves the row, as dragging it does.
    onAltKey: (id, key) => {
      if (!onUpdateView || (key !== "ArrowUp" && key !== "ArrowDown")) return false;
      onUpdateView({ order: nudge(rows.map((r) => r.id), id, key === "ArrowUp" ? -1 : 1) });
      return true;
    },
  });

  return (
    <html.div {...cards.containerProps} style={styles.list}>
      {listed.map(({ row, starts }, i) => {
        const dropReg = canDrag ? registerRow(row.id) : undefined;
        const isDropTarget =
          draggedRowId !== null &&
          hoveredRowId === row.id &&
          hoveredRowId !== draggedRowId;
        return (
          <Fragment key={row.id}>
          {starts && (
            <html.div style={styles.listGroup}>
              <html.span style={styles.groupLabel}>
                {view.group ? (fieldMap.get(view.group.field)?.title ?? view.group.field) : ""} · {starts.label}
                <html.span style={styles.groupCount}>{`${SPAN_GAP}${starts.count}`}</html.span>
              </html.span>
            </html.div>
          )}
          <DragHandle
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ref={(el: any) => {
                cards.cardRef(row.id)(el);
                dropReg?.ref(el);
              }}
              onClick={() => {
                cards.setFocusId(row.id);
                onOpenBody?.(row.id);
              }}
              style={[
                styles.listItem,
                cards.focusId === row.id && styles.listItemFocused,
                viewportWidth <= TOUCH_VIEWPORT_MAX && styles.listItemTouch,
                i === rows.length - 1 && styles.listItemLast,
                canDrag && styles.draggableHandle,
                draggedRowId === row.id && styles.listItemDragging,
                isDropTarget && styles.listItemDropTarget,
              ]}
            >
              {/* The badge beside the title, not inside it: on native a span is a
                  Text, and one nested in it loses its margin. */}
              <html.div style={styles.listItemTitle}>
                <html.span dir="auto" style={styles.listItemTitleText}>
                  {titleField ? formatValue(row[titleField]) : ""}
                </html.span>
                {bodies?.[row.id] ? (
                  <BodyBadge besideTitle onClick={onOpenBody ? () => onOpenBody(row.id) : undefined} />
                ) : null}
              </html.div>
              {secondaryFields.map((name) => (
                <html.div key={name} style={styles.listItemSecondary}>
                  <CellValue
                    field={fieldMap.get(name)}
                    value={row[name]}
                    relatedTables={relatedTables}
                    onOpenRelation={onOpenRelation}
                  />
                </html.div>
              ))}
            </html.div>
          </DragHandle>
          </Fragment>
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
 * `YYYY-MM-DD` (or the date part of a datetime) as a LOCAL calendar
 * day. `new Date("2026-01-15")` is midnight UTC, which west of UTC is
 * the evening of the 14th — so the day shown, and the month the
 * calendar opens on, came out a day early there.
 */

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
 * Layout: 7 columns × 6 rows. Day cells size via `dayColWidth(colIndex)`,
 * which divides the measured container by 7 and distributes the
 * remainder pixel-by-pixel across the leftmost columns so the grid
 * fills the available width exactly with no right-edge gap.
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
  // Google Calendar pattern. On a phone the cells show dots; wider,
  // they show each entry's title, and clicking a title opens it.
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const isTouchViewport = useViewportWidth() <= TOUCH_VIEWPORT_MAX;
  // A title chip sits inside its day's button. The chip's click marks
  // itself handled so the day's click doesn't also open the sheet —
  // this works whether or not a platform lets a click stop propagating.
  const chipClicked = useRef(false);

  // Measure the calendar's own container — viewport width would be
  // wrong on web layouts with a sidebar (calendar's parent is the
  // main pane, narrower than the window). 7 columns means every cell
  // is `floor(containerWidth / 7)`; until the first layout pass
  // completes width is 0, so we guard with a tiny fallback that
  // doesn't visibly flash.
  const { measureProps, width: containerWidth } = useContainerWidth();
  // 7 columns. `floor(width / 7)` alone leaves up to 6px of dead space
  // on the right (the grid's border floating away from the cells); the
  // remainder is spread one pixel at a time across the leftmost
  // columns so weekdays + day cells fill the width exactly and line up
  // vertically (each row keys its width on `colIndex`, not position).
  // `− 2` accounts for the calendar's own 1px left/right border.
  const calAvailable = Math.max(0, containerWidth - 2);
  const baseDayWidth = containerWidth > 0 ? Math.floor(calAvailable / 7) : 0;
  const dayRemainder = containerWidth > 0 ? calAvailable - baseDayWidth * 7 : 0;
  const dayColWidth = (colIndex: number) =>
    baseDayWidth + (colIndex < dayRemainder ? 1 : 0);

  // Opens on the earliest dated row's month, inside `calendar_range`.
  const [cursor, setCursor] = useState(() => initialMonth(view, rows));

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
  // 6 weeks × 7 days, padded with the neighbouring months, whatever
  // day of the week the 1st falls on in this locale.
  const cells = monthGrid(cursor, weekStart);

  const rowsByDate = rowsByDay(rows, calField);

  const titleField = schema.fields[0]?.name;
  const labelOf = (row: Row) => rowTitle(row, titleField);
  const today = new Date();

  // Range-aware navigation. When prev/next would step outside the
  // bounds (if any), the button disables visually + functionally.
  const { prev: canGoPrev, next: canGoNext } = canStep(view, cursor);

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
            style={[styles.calendarWeekday, styles.cellWidth(dayColWidth(i))]}
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
          const isToday = key === dateKey(today);
          const chips = dayRows.slice(0, CALENDAR_CHIPS_PER_DAY);
          const moreCount = dayRows.length - chips.length;
          return (
            <html.button
              key={i}
              onClick={() => {
                if (chipClicked.current) {
                  chipClicked.current = false;
                  return;
                }
                setSelectedDateKey(key);
              }}
              style={[
                styles.calendarDay,
                styles.calendarDayButton,
                styles.cellWidth(dayColWidth(i % 7)),
                // The calendar's own border is the outer edge; the last
                // column and last week don't draw a second one.
                i % 7 === 6 && styles.noRightBorder,
                i >= cells.length - 7 && styles.noBottomBorder,
                !cell.inMonth && styles.calendarDayOther,
              ]}
            >
              <html.span style={[styles.calendarDayNum, isToday && styles.calendarDayToday]}>
                {cell.date.getDate()}
              </html.span>
              {!isTouchViewport && chips.length > 0 && (
                <html.div style={styles.calendarChips}>
                  {chips.map((row) => (
                    <html.span
                      key={row.id}
                      onClick={() => {
                        chipClicked.current = true;
                        onOpenBody?.(row.id);
                      }}
                      style={styles.calendarChip}
                    >
                      {labelOf(row)}
                    </html.span>
                  ))}
                  {moreCount > 0 && (
                    <html.span style={styles.calendarChipMore}>+{moreCount} more</html.span>
                  )}
                </html.div>
              )}
              {isTouchViewport && dayRows.length > 0 && (
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
          ? localDay(selectedDateKey)!.toLocaleDateString(undefined, {
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
                return (
                  <html.button
                    key={row.id}
                    onClick={() => {
                      setSelectedDateKey(null);
                      onOpenBody?.(row.id);
                    }}
                    style={styles.daySheetItem}
                  >
                    {labelOf(row)}
                    {bodies?.[row.id] ? <BodyBadge /> : null}
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
  /** The row has a long-form body (its page); the card shows the PAGE badge. */
  hasBody?: boolean;
}

function Card({ row, fields, fieldMap, relatedTables, onOpenRelation, hasBody }: CardProps) {
  const titleField = fields[0];
  const restFields = fields.slice(1);
  return (
    <html.div style={styles.card}>
      {titleField && (
        // The badge beside the title, not inside it (see the list's title).
        <html.div style={styles.titleWithBadge}>
          <html.span dir="auto" style={styles.cardTitle}>
            {formatValue(row[titleField])}
          </html.span>
          {hasBody ? <BodyBadge besideTitle /> : null}
        </html.div>
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
          <html.span style={styles.cardFieldLabel}>{fieldMap.get(name)?.title ?? name}</html.span>
          <html.div style={styles.cardFieldValue}>
            <CellValue
              field={fieldMap.get(name)}
              value={row[name]}
              relatedTables={relatedTables}
              onOpenRelation={onOpenRelation}
              inColumn
            />
          </html.div>
        </html.div>
      ))}
    </>
  );
}
