// A `.table` drawn inside something else (a document that links to it): the
// drop-in for a GTK app. It reads the file and writes edits back, through
// table-app. Apart from the views (`.`), which hold nothing and touch no file.

export { TableEmbed, EMBED_MAX_HEIGHT, type TableEmbedProps } from "./TableEmbed.js";
export { readEmbed, type EmbedTarget } from "@workspace.sh/table-app/node";
export type { EmbedProblem, EmbedRead, EmbedShown } from "@workspace.sh/table-app";
