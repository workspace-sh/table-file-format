import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { html, css } from "react-strict-dom";
import { applyGroup, effectiveAlign } from "@workspace/table-core";
import type {
  Field,
  FieldAlignment,
  Row,
  TableSchema,
  View,
} from "@workspace/table-core";
import { AddFieldButton, SchemaFieldEditor } from "./SchemaEditor";
import { useViewportWidth } from "./internal/useViewportWidth";
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
    minWidth: 240,
    maxWidth: 320,
    flex: 1,
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
    // Container-relative width (not viewport-relative) so weekday
    // headers and day cells share the same column geometry regardless
    // of how wide the calendar's parent is. 100/7 = 14.2857%.
    // box-sizing: border-box is critical on web — without it, the
    // default content-box makes padding sit *outside* the percentage,
    // so 7 cells overflow the container and only 6 fit per row. RN is
    // border-box natively, so this just unifies the two platforms.
    width: "14.2857%",
    boxSizing: "border-box",
    flexShrink: 0,
    flexGrow: 0,
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
    // Same percentage width as calendarWeekday — guarantees headers
    // and cells share the same column geometry. box-sizing as above.
    width: "14.2857%",
    boxSizing: "border-box",
    flexShrink: 0,
    flexGrow: 0,
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

function CellValue({ field, value }: { field: Field | undefined; value: unknown }) {
  const isEnum = field?.constraints?.enum != null;
  if (isEnum && value !== undefined && value !== null && value !== "") {
    return <html.span style={styles.pill}>{String(value)}</html.span>;
  }
  return <html.span>{formatValue(value)}</html.span>;
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
}

function EditableCell({ field, value, onCommit }: EditableCellProps) {
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
          <CellValue field={field} value={value} />
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
  onUpdateRow?: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField?: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue?: (fieldName: string, value: string) => void;
  onMoveField?: (fieldName: string, delta: -1 | 1) => void;
  onAddField?: (field: Field) => void;
  onOpenBody?: (rowId: string) => void;
  onUpdateView?: (patch: Partial<View>) => void;
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
 * Drag session: tracks pointer viewport coords AND disables text
 * selection globally while a drag is active. Both concerns are about
 * "we're in the middle of a drag gesture" so they live in the same hook.
 *
 * On web (this implementation): document.pointermove + body.style.userSelect.
 * On RN (Workspace UI kit substitution): react-native-gesture-handler
 * driving the same return shape — no body-level userSelect concept on
 * native, so that part becomes a no-op.
 */
function useDragPointer(active: boolean) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!active) {
      setPos(null);
      return;
    }
    const onMove = (e: PointerEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener("pointermove", onMove);

    // Prevent text/UI highlight when the pointer drags across cell
    // content. Restore the previous value on cleanup so we don't leak
    // a permanent change to body styles.
    const prevUserSelect = document.body.style.userSelect;
    const prevWebkitUserSelect = (document.body.style as unknown as {
      webkitUserSelect: string;
    }).webkitUserSelect;
    document.body.style.userSelect = "none";
    (document.body.style as unknown as { webkitUserSelect: string }).webkitUserSelect =
      "none";
    // Clear any selection already in place so it doesn't visually persist
    // while we drag.
    window.getSelection()?.removeAllRanges();

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.body.style.userSelect = prevUserSelect;
      (document.body.style as unknown as { webkitUserSelect: string }).webkitUserSelect =
        prevWebkitUserSelect;
    };
  }, [active]);
  return pos;
}

/**
 * Floating ghost that follows the pointer during drag. Rendered via
 * createPortal to document.body so no parent overflow clips it.
 */
function DragGhost({
  pointerPos,
  children,
}: {
  pointerPos: { x: number; y: number } | null;
  children: ReactNode;
}) {
  if (!pointerPos) return null;
  return createPortal(
    <html.div
      style={[styles.ghost, styles.ghostPosition(pointerPos.x + 14, pointerPos.y + 14)]}
    >
      {children}
    </html.div>,
    document.body,
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
  onUpdateRow,
  onUpdateField,
  onAddEnumValue,
  onMoveField,
  onAddField,
  onOpenBody,
}: ViewProps) {
  const fields = visibleFields(view, schema);
  const fieldMap = fieldsByName(schema);
  const titleField = fields[0];
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const headerButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const schemaEditable = !!(onUpdateField && onAddEnumValue && onMoveField);
  const canAddField = !!onAddField;
  const lastFieldThreshold = Math.max(0, schema.fields.length - 2);

  // Responsive cell width: cells fill the viewport when there's room
  // (macOS / web wide windows) and snap to MIN_CELL_WIDTH on narrow
  // viewports (mobile portrait), triggering horizontal scroll via the
  // consumer's ScrollView wrapper. Reactive to resize / orientation
  // change via `useViewportWidth` (web: window resize listener; native:
  // RN's useWindowDimensions).
  const viewportWidth = useViewportWidth();
  const totalCols = fields.length + (canAddField ? 1 : 0);
  const cellWidth = Math.max(MIN_CELL_WIDTH, Math.floor(viewportWidth / totalCols));

  return (
    <html.div style={styles.table}>
      <html.div style={[styles.tableRow, styles.tableHeaderRow]}>
        {fields.map((name, idx) => {
          const field = fieldMap.get(name);
          const isEditing = editingFieldName === name;
          const fieldIndex = schema.fields.findIndex((f) => f.name === name);
          const align = effectiveAlign(field);
          const isLast = idx === fields.length - 1 && !canAddField;
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
                ref={(el: HTMLButtonElement | null) => {
                  headerButtonRefs.current[name] = el;
                }}
                onClick={() => {
                  if (isEditing) {
                    setEditingFieldName(null);
                  } else {
                    const el = headerButtonRefs.current[name];
                    if (el) setAnchorRect(el.getBoundingClientRect());
                    setEditingFieldName(name);
                  }
                }}
                style={[
                  styles.headerCellButton,
                  field?.deprecated && styles.headerCellDeprecated,
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
        })}
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
          style={[styles.tableRow, i === rows.length - 1 && styles.tableRowLast]}
        >
          {fields.map((name, idx) => {
            const field = fieldMap.get(name);
            const align = effectiveAlign(field);
            const isLast = idx === fields.length - 1 && !canAddField;
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
                  />
                ) : (
                  <CellValue field={field} value={row[name]} />
                )}
                {name === titleField && bodies?.[row.id] ? (
                  <BodyBadge onClick={onOpenBody ? () => onOpenBody(row.id) : undefined} />
                ) : null}
              </html.span>
            );
          })}
          {canAddField && <html.div style={styles.addFieldSpacer} />}
        </html.div>
      ))}
    </html.div>
  );
}

export function BoardView({ view, rows, schema, onUpdateRow }: ViewProps) {
  const groupField = view.board_field ?? "status";
  const groupFieldDef = schema.fields.find((f) => f.name === groupField);
  const enumValues = groupFieldDef?.constraints?.enum;
  const fields = visibleFields(view, schema).filter((f) => f !== groupField);
  const fieldMap = fieldsByName(schema);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const canDrag = !!onUpdateRow;
  const pointerPos = useDragPointer(!!draggedRowId);

  // Live preview: while dragging, render groups as if the dragged row
  // were already in the hovered column. The actual mutation only commits
  // on pointerup via onUpdateRow.
  const displayRows =
    draggedRowId && hoveredColumn
      ? rows.map((r) =>
          r.id === draggedRowId
            ? { ...r, [groupField]: hoveredColumn === "(empty)" ? null : hoveredColumn }
            : r,
        )
      : rows;
  const groups = applyGroup(displayRows, groupField, schema);

  // Persistent columns: when the group field has an enum constraint,
  // show ALL enum values as columns (even when empty) so the user can
  // drop cards into a column that currently has no rows.
  const columnKeys: string[] = enumValues
    ? (() => {
        const keys = [...enumValues];
        for (const k of Object.keys(groups)) {
          if (!keys.includes(k)) keys.push(k);
        }
        return keys;
      })()
    : Object.keys(groups);

  // Fallback: clear drag state on document-level pointerup.
  useEffect(() => {
    if (!draggedRowId) return;
    const onUp = () => {
      setDraggedRowId(null);
      setHoveredColumn(null);
    };
    document.addEventListener("pointerup", onUp);
    return () => document.removeEventListener("pointerup", onUp);
  }, [draggedRowId]);

  const drop = (columnKey: string) => {
    if (!draggedRowId || !onUpdateRow) {
      setDraggedRowId(null);
      setHoveredColumn(null);
      return;
    }
    const row = rows.find((r) => r.id === draggedRowId);
    if (row && row[groupField] !== columnKey) {
      onUpdateRow(
        draggedRowId,
        groupField,
        columnKey === "(empty)" ? null : columnKey,
      );
    }
    setDraggedRowId(null);
    setHoveredColumn(null);
  };

  return (
    <html.div style={styles.board}>
      {columnKeys.map((key) => {
        const groupRows = groups[key] ?? [];
        return (
          <html.div
            key={key}
            style={[
              styles.boardColumn,
              hoveredColumn === key && draggedRowId !== null && styles.boardColumnDropTarget,
            ]}
            onPointerEnter={
              canDrag
                ? () => {
                    if (draggedRowId) setHoveredColumn(key);
                  }
                : undefined
            }
            onPointerLeave={
              canDrag
                ? () => setHoveredColumn((prev) => (prev === key ? null : prev))
                : undefined
            }
            onPointerUp={
              canDrag
                ? () => {
                    if (draggedRowId) drop(key);
                  }
                : undefined
            }
          >
            <html.div style={styles.boardColumnHeader}>
              <html.span>{key}</html.span>
              <html.span style={styles.boardCount}>{groupRows.length}</html.span>
            </html.div>
            {groupRows.map((row) => (
              <html.div
                key={row.id}
                onPointerDown={
                  canDrag
                    ? () => {
                        setDraggedRowId(row.id);
                        setHoveredColumn(key);
                      }
                    : undefined
                }
                style={[
                  styles.boardCardWrapper,
                  canDrag && styles.draggableHandle,
                  draggedRowId === row.id && styles.cardDragging,
                ]}
              >
                <Card row={row} fields={fields} fieldMap={fieldMap} />
              </html.div>
            ))}
          </html.div>
        );
      })}
      {draggedRowId &&
        (() => {
          const row = rows.find((r) => r.id === draggedRowId);
          if (!row) return null;
          return (
            <DragGhost pointerPos={pointerPos}>
              <Card row={row} fields={fields} fieldMap={fieldMap} />
            </DragGhost>
          );
        })()}
    </html.div>
  );
}

export function GalleryView({ view, rows, schema, bodies, onOpenBody }: ViewProps) {
  const galleryField = view.gallery_field;
  const fields = visibleFields(view, schema).filter((f) => f !== galleryField);
  const fieldMap = fieldsByName(schema);

  return (
    <html.div style={styles.gallery}>
      {rows.map((row) => {
        const excerpt = bodyExcerpt(bodies?.[row.id]);
        const hasBody = !!bodies?.[row.id];
        return (
          <html.div key={row.id} style={[styles.card, styles.galleryCard]}>
            {galleryField && (
              <html.span style={styles.galleryCardHero}>
                {formatValue(row[galleryField])}
              </html.span>
            )}
            <CardBody row={row} fields={fields} fieldMap={fieldMap} hideTitle={!!galleryField} />
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
}: ViewProps) {
  const fields = visibleFields(view, schema);
  const titleField = fields[0] ?? schema.fields[0]?.name;
  const secondaryFields = fields.slice(1);
  const fieldMap = fieldsByName(schema);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const canDrag = !!onUpdateView;
  const pointerPos = useDragPointer(!!draggedRowId);

  // Live reorder preview: while dragging, rebuild the visible order so
  // the dragged row physically appears in its hover-target position. The
  // preview is computed from the BASE rows (not the previous preview),
  // so hovering A then B gives the same result as hovering B directly.
  const displayRows: Row[] = previewOrder
    ? (() => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered: Row[] = [];
        for (const id of previewOrder) {
          const r = byId.get(id);
          if (r) ordered.push(r);
        }
        // Any base rows not in previewOrder go at the end (shouldn't
        // happen since preview is computed from all current ids, but
        // safe).
        for (const r of rows) if (!previewOrder.includes(r.id)) ordered.push(r);
        return ordered;
      })()
    : rows;

  // Fallback: clear drag state on document-level pointerup. Drop is
  // committed by the row's own onPointerUp; this only fires when the
  // pointer releases outside any row.
  useEffect(() => {
    if (!draggedRowId) return;
    const onUp = () => {
      setDraggedRowId(null);
      setPreviewOrder(null);
    };
    document.addEventListener("pointerup", onUp);
    return () => document.removeEventListener("pointerup", onUp);
  }, [draggedRowId]);

  const computePreviewOrder = (targetRowId: string): string[] => {
    if (!draggedRowId) return rows.map((r) => r.id);
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(draggedRowId);
    const to = ids.indexOf(targetRowId);
    if (from === -1 || to === -1) return ids;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  };

  const commitDrop = () => {
    if (!draggedRowId || !onUpdateView || !previewOrder) {
      setDraggedRowId(null);
      setPreviewOrder(null);
      return;
    }
    onUpdateView({ order: previewOrder });
    setDraggedRowId(null);
    setPreviewOrder(null);
  };

  return (
    <html.div style={styles.list}>
      {displayRows.map((row, i) => (
        <html.div
          key={row.id}
          onPointerDown={
            canDrag
              ? () => {
                  setDraggedRowId(row.id);
                  setPreviewOrder(rows.map((r) => r.id));
                }
              : undefined
          }
          onPointerEnter={
            canDrag
              ? () => {
                  if (draggedRowId && draggedRowId !== row.id) {
                    setPreviewOrder(computePreviewOrder(row.id));
                  }
                }
              : undefined
          }
          onPointerUp={canDrag ? () => commitDrop() : undefined}
          style={[
            styles.listItem,
            i === displayRows.length - 1 && styles.listItemLast,
            canDrag && styles.draggableHandle,
            draggedRowId === row.id && styles.listItemDragging,
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
              <CellValue field={fieldMap.get(name)} value={row[name]} />
            </html.span>
          ))}
        </html.div>
      ))}
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

  // Anchor the cursor on the earliest date in the data so the calendar
  // doesn't render an empty month when fixture dates are in the past
  // relative to "today".
  const [cursor, setCursor] = useState(() => {
    if (calField) {
      const earliest = rows
        .map((r) => r[calField])
        .filter((v): v is string => typeof v === "string" && v.length >= 10)
        .map((s) => new Date(s.slice(0, 10)))
        .filter((d) => !Number.isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (earliest) {
        return new Date(earliest.getFullYear(), earliest.getMonth(), 1);
      }
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
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

  return (
    <html.div style={styles.calendar}>
      <html.div style={styles.calendarHeader}>
        <html.button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          style={styles.calendarNav}
        >
          ‹
        </html.button>
        <html.span style={styles.calendarTitle}>
          {monthName} {year}
        </html.span>
        <html.button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          style={styles.calendarNav}
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
            style={styles.calendarWeekday}
          >
            {d}
          </html.span>
        ))}
      </html.div>
      <html.div style={styles.calendarGrid}>
        {cells.map((cell, i) => {
          const key = dateKey(cell.date);
          const dayRows = rowsByDate.get(key) ?? [];
          return (
            <html.div
              key={i}
              style={[
                styles.calendarDay,
                !cell.inMonth && styles.calendarDayOther,
              ]}
            >
              <html.span style={styles.calendarDayNum}>
                {cell.date.getDate()}
              </html.span>
              {dayRows.map((row) => {
                const label = titleField
                  ? formatValue(row[titleField])
                  : row.id;
                if (onOpenBody && bodies?.[row.id]) {
                  return (
                    <html.button
                      key={row.id}
                      onClick={() => onOpenBody(row.id)}
                      style={styles.calendarRowChip}
                    >
                      {label}
                    </html.button>
                  );
                }
                return (
                  <html.span key={row.id} style={styles.calendarRowChip}>
                    {label}
                  </html.span>
                );
              })}
            </html.div>
          );
        })}
      </html.div>
    </html.div>
  );
}

interface CardProps {
  row: Row;
  fields: string[];
  fieldMap: Map<string, Field>;
}

function Card({ row, fields, fieldMap }: CardProps) {
  const titleField = fields[0];
  const restFields = fields.slice(1);
  return (
    <html.div style={styles.card}>
      {titleField && (
        <html.span style={styles.cardTitle}>{formatValue(row[titleField])}</html.span>
      )}
      <CardBody row={row} fields={restFields} fieldMap={fieldMap} hideTitle />
    </html.div>
  );
}

function CardBody({
  row,
  fields,
  fieldMap,
}: CardProps & { hideTitle?: boolean }) {
  return (
    <>
      {fields.map((name) => (
        <html.div key={name} style={styles.cardField}>
          <html.span style={styles.cardFieldLabel}>{name}</html.span>
          <html.span style={styles.cardFieldValue}>
            <CellValue field={fieldMap.get(name)} value={row[name]} />
          </html.span>
        </html.div>
      ))}
    </>
  );
}
