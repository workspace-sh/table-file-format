// table-app's drop-in for a `.table` drawn inside a document, over
// table-ui's views (embedView.shared.tsx). The frame and dialog are each
// platform's: a bundler takes embedFrame.web.tsx on the web and
// embedFrame.tsx on iOS, Android and macOS, as table-ui's own files do.

export { EMBED_MAX_HEIGHT, TableEmbed, type TableEmbedProps } from "./embedFrame";
