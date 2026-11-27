/* tslint:disable */
/* eslint-disable */

/**
 * A workbook's computed columns, encoded as `workspace_edn::column::compute` describes.
 */
export class ColumnResults {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly extra: string;
    readonly index: string;
    readonly kinds: Uint8Array;
    readonly numbers: Float64Array;
}

/**
 * Rows as they cross back (`workspace_table::held::Window`); each getter copies, so read each once.
 */
export class RowsWindow {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly ends: Uint32Array;
    readonly entries: Uint16Array;
    readonly kinds: Uint8Array;
    readonly numbers: Float64Array;
    readonly texts: string;
}

/**
 * A `.table` engine operation (`workspace_table::call`): its input and answer JSON text. Never throws:
 * a mistake is `{"error": "…"}`.
 */
export function call(op: string, input: string): string;

/**
 * A `.table` engine operation that takes a file's bytes (`workspace_table::call_bytes`): JSON
 * answered, never thrown.
 */
export function callBytes(op: string, input: string, bytes: Uint8Array): string;

/**
 * A `.table` engine check of one text (`workspace_table::check`); undefined when `op` isn't one.
 */
export function callCheck(op: string, text: string): boolean | undefined;

/**
 * A `.table` engine number from one text (`workspace_table::number`); undefined when `op` isn't one.
 */
export function callNumber(op: string, text: string): number | undefined;

/**
 * A `.table` engine operation that gives rows (`workspace_table::window`), or throws `{"error": "…"}`.
 */
export function callWindow(op: string, input: string): RowsWindow;

/**
 * The canonical form of `text`, or throws `{message, line, column}` as JSON.
 */
export function canonical(text: string): string;

/**
 * A workbook's formulas computed (see `workspace_edn::workbook::workbook_from` and `column::compute`); `index` comes back in `extra`'s place as a second string.
 */
export function computeWorkbook(json: string, numbers: Float64Array): ColumnResults;

/**
 * A `.table` formula read, as JSON in the shape `.table`'s evaluator takes (`parseExpr`'s `Expr`), or throws as `canonical` does.
 */
export function formula(text: string): string;

/**
 * `text` read, as a JSON tree (one object per value, `{"t": kind, "v": ...}`), or throws as `canonical` does.
 */
export function read(text: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_columnresults_free: (a: number, b: number) => void;
    readonly __wbg_rowswindow_free: (a: number, b: number) => void;
    readonly call: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly callBytes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly callCheck: (a: number, b: number, c: number, d: number) => number;
    readonly callNumber: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly callWindow: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly canonical: (a: number, b: number, c: number) => void;
    readonly columnresults_extra: (a: number, b: number) => void;
    readonly columnresults_index: (a: number, b: number) => void;
    readonly columnresults_kinds: (a: number, b: number) => void;
    readonly columnresults_numbers: (a: number, b: number) => void;
    readonly computeWorkbook: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly formula: (a: number, b: number, c: number) => void;
    readonly read: (a: number, b: number, c: number) => void;
    readonly rowswindow_ends: (a: number, b: number) => void;
    readonly rowswindow_entries: (a: number, b: number) => void;
    readonly rowswindow_kinds: (a: number, b: number) => void;
    readonly rowswindow_numbers: (a: number, b: number) => void;
    readonly rowswindow_texts: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
