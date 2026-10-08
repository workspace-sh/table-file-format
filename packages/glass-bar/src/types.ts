/**
 * What the bar shows. The host app owns this and changes it in response to
 * the callbacks; the bar animates between whatever it is given.
 */
export type GlassBarState =
  /** Filter, Search and More. A non-empty query shows as results, with its clear button. */
  | { kind: "rest"; query?: string }
  /** Search raised above the keyboard. */
  | { kind: "searching"; query: string }
  /**
   * A selected cell: its label ("Owner · iOS Pro launch") and value or
   * formula; a line about the field when it has one; `info`, an ⓘ for more.
   */
  | { kind: "selected"; label: string; value: string; monospaced?: boolean; about?: string; info?: boolean }
  /** The editor. */
  | GlassBarEditing
  /** Picking a field's choices: no keyboard. `multiple`: each tap turns one on or off. */
  | { kind: "choosing"; label: string; detail?: string; choices: GlassBarChoice[]; selected?: string | string[]; multiple?: boolean; canAdd?: boolean; canClear?: boolean }
  /** Picking a date or time with the system's calendar: no keyboard. */
  | { kind: "dating"; label: string; detail?: string; value?: Date; components: ("date" | "hourAndMinute")[]; shown?: string; canClear?: boolean };

export type GlassBarEditing = {
  kind: "editing";
  /** Identifies one edit; a new key starts a new field (moving to the next row). */
  editKey: string;
  /** What is being edited ("Owner", "ƒ Left · every row"). */
  label: string;
  /** The right-hand side of the header: the row, or this row's result. */
  detail?: string;
  /** The value the field starts with. */
  initialValue: string;
  /**
   * `line`: a short value; Return saves and moves on.
   * `formula`: monospaced, grows up to five lines; Return saves.
   * `text`: long text, grows; Return is a new line, so only Save saves.
   */
  mode: "line" | "formula" | "text";
  /**
   * A one-line value that may still run long (any text): it wraps as it
   * grows and can expand, though Return still saves and moves on. Formulas
   * and `text` always can; numbers, dates and the like never.
   */
  expandable?: boolean;
  keyboard?: "default" | "decimal-pad" | "numeric" | "numbers-and-punctuation" | "email-address" | "url" | "phone-pad";
  /** Shown before the field, in the field's own type: a currency's symbol. */
  prefix?: string;
  /** Word suggestions, autocorrection and capitals. Off for anything but prose. Default on. */
  suggestions?: boolean;
  /** Buttons above the capsule: operators, or suggestions. */
  chips?: GlassBarChip[];
  /**
   * How the value is worked out (a formula: what it read, its result and
   * what saving gives), shown under the field while the bar is expanded.
   */
  working?: GlassBarWorking;
  /** Why it can't be saved, with an optional fix. */
  error?: { message: string; fixLabel?: string };
};

/**
 * A button above the capsule. `insert`: text the bar puts at the cursor
 * when tapped (an operator), stepping back `cursorBack` characters after it
 * (1 puts the cursor between a pair of brackets); otherwise only `onChip`
 * runs. `symbol`: an SF Symbol name. When every chip has one, the chips
 * share one glass background, as a toolbar's buttons do; `label` is then
 * what VoiceOver reads.
 */
export type GlassBarChip = { id: string; label: string; detail?: string; insert?: string; cursorBack?: number; symbol?: string };

/** Imperative access for the host app: tapping a column while writing a formula inserts its name. */
export type GlassBarHandle = { insert: (text: string, cursorBack?: number) => void };
/** A choice, optionally in its own colours (a light wash of `bg`, the label in `fg`). */
export type GlassBarChoice = { id: string; label: string; colors?: { light: { bg: string; fg: string }; dark: { bg: string; fg: string } } };

/** A formula's working, a section at a time: rows of a label and the value it stands for. */
export type GlassBarWorking = {
  sections: { title?: string; rows: { label: string; value: string; strong?: boolean }[] }[];
};

/** One action in the More menu. */
export type GlassBarAction = { label: string; symbol?: string; onPress: () => void };

export type GlassBarProps = {
  state: GlassBarState;
  /** More's menu. Without it, More calls `onMore`. */
  moreActions?: GlassBarAction[];
  ref?: import("react").Ref<GlassBarHandle>;
  onFilter?: () => void;
  onMore?: () => void;
  /** Rest: Search tapped. */
  onSearch?: () => void;
  onQueryChange?: (query: string) => void;
  /** Searching: Close, or Return. The query stays. */
  onSearchEnd?: () => void;
  onClearQuery?: () => void;
  /** Selected: the capsule tapped, to edit. */
  onEdit?: () => void;
  /** Selected: ✕. */
  onDeselect?: () => void;
  /** Selected: the ⓘ, for what the field is. */
  onInfo?: () => void;
  /** Expanded, under a formula's working: open the field's settings. */
  onFieldSettings?: () => void;
  /** Editing or choosing: ✕. Discards the edit. */
  onCancel?: () => void;
  onChange?: (value: string) => void;
  /** Save tapped. */
  onSave?: (value: string) => void;
  /**
   * Return in a `line` or `formula` field: save and move on. The bar never
   * saves on its own when the keyboard goes; a host whose content dismisses
   * the keyboard by scrolling should save when that scroll begins.
   */
  onSubmit?: (value: string) => void;
  onChip?: (id: string) => void;
  onFix?: () => void;
  onChoose?: (id: string) => void;
  /** The "+" after the choices: add a new one. */
  onAddChoice?: () => void;
  /** Choosing one, or a date: "None" or Clear empties the cell. */
  onClear?: () => void;
  onPickDate?: (date: Date) => void;
  /** The editor expanded or collapsed: a host can scroll what's edited into view above it. */
  onExpandChange?: (expanded: boolean) => void;
  /** The bar's height as laid out (above the home indicator or keyboard), for keeping content clear of it. */
  onHeight?: (height: number) => void;
};
