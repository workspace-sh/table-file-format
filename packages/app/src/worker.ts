// What a worker holding a bundle's index uses (apps/web's SQLite worker),
// without the rest of the package: its index re-exports modules that bring
// table-ui's React components, which a worker can't load.

export { INDEXED_FROM, buildIndexFromBytes, canBeIndexed, firstRowsInBytes, linesInBytes, readHeldRows } from "./indexed.ts";
export { openArchive, type OpenedBundle } from "./tableFiles.ts";
export { rowsServer, type RowsRequest } from "./remoteRows.ts";
