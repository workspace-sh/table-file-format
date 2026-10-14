// A `.table` drawn inside something else (a document that links to it), and
// a `.table` opened as a document of its own: the drop-ins for a GTK app.
// They read the file and write edits back, through table-app. Apart from the views (`.`), which hold nothing and touch no file.

export { TableEmbed, EMBED_MAX_HEIGHT, type TableEmbedProps } from "./TableEmbed.js";
export { TableFile, type TableFileProps } from "./TableFile.js";
export { readEmbed, readTableFile, type EmbedTarget } from "@workspace.sh/table-app/node";
export type { EmbedProblem, EmbedRead, EmbedShown } from "@workspace.sh/table-app";
