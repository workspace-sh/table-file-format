// One file of a .table, shown in place of a view: what the Files side of
// the sidebar opens, as on the web. Text as saving writes it, or an
// attachment.

import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import type { FilesTreeFile } from "@workspace.sh/table-app";

export interface FileViewProps {
  /** Where the file sits: `crm.table/tables/deals/`, or an opened folder's own name. */
  folder: string;
  file: FilesTreeFile;
  /** Its text, for a text file. */
  content?: string;
  /** Where to show it from, for an attachment. */
  url?: string;
  onClose: () => void;
}

export function FileView({ folder, file, content, url, onClose }: FileViewProps) {
  const attachment = file.opens === "attachment";
  return (
    <html.div style={styles.root}>
      <html.span dir="ltr" style={styles.breadcrumb}>{folder}</html.span>
      <html.div style={styles.titleRow}>
        <html.span dir="ltr" style={styles.title}>{file.name}</html.span>
        <html.button style={styles.back} onClick={onClose}>
          Back to the table
        </html.button>
      </html.div>
      <html.span style={styles.note}>
        {attachment
          ? "An attachment: a file the table's rows name, kept beside them."
          : "As saving writes it. Export .table.zip carries the same files."}
      </html.span>
      {attachment ? (
        url && IMAGE.test(file.name) ? (
          <html.img src={url} alt={file.name} style={styles.image} />
        ) : (
          <html.span style={styles.note}>{url ? "Not an image, so there's nothing to preview." : "Not found."}</html.span>
        )
      ) : (
        // Long lines scroll sideways, as the web's <pre> does.
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          <ScrollView style={{ flex: 1 }}>
            <html.div style={styles.content}>
              <html.span dir="ltr" style={styles.text}>{content ?? ""}</html.span>
            </html.div>
          </ScrollView>
        </ScrollView>
      )}
    </html.div>
  );
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|heic|tiff?)$/i;

const text = { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" };
const dim = { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" };
const mono = "Menlo";

const styles = css.create({
  root: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  breadcrumb: { fontSize: 12, marginBottom: 2, fontFamily: mono, color: dim },
  titleRow: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 20, fontWeight: "600", fontFamily: mono, color: text },
  note: { fontSize: 12, marginTop: 4, marginBottom: 16, color: dim },
  back: {
    paddingInline: 10,
    paddingBlock: 5,
    fontSize: 13,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#17171a" },
    color: text,
  },
  content: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: { default: "#f5f5f7", "@media (prefers-color-scheme: dark)": "#17171a" },
  },
  text: { fontSize: 12, lineHeight: 1.5, fontFamily: mono, color: text },
  image: { width: 240, height: 240, objectFit: "contain", borderRadius: 8 },
});
