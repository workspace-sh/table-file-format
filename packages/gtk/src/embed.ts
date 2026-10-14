// A `.table` drawn inside something else (a document that links to it), and
// a `.table` opened as a document of its own: the drop-ins for a GTK app.
// They read the file and write edits back, through table-app. Apart from the views (`.`), which hold nothing and touch no file.

export { TableEmbed, EMBED_MAX_HEIGHT, type TableEmbedProps } from "./TableEmbed.js";
export { TableFile, type TableFileProps } from "./TableFile.js";
export { readEmbed, readTableFile, type EmbedTarget } from "@workspace.sh/table-app/node";
export type { EmbedProblem, EmbedRead, EmbedShown } from "@workspace.sh/table-app";
// A table too large to hold in memory, read through its bundle's index (SPEC section 8) by an app on
// Node: the hook over table-app's state, and the index in a worker of its own.
export { useIndexedTables, type IndexedTables } from "./indexed/useIndexedTables.js";
export { openWorkerIndexHost } from "./indexed/indexClient.js";
export { FewRows, LAYOUT_ROWS } from "./indexed/FewRows.js";
