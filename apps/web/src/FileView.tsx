import { html, css } from "react-strict-dom";
import type { AttachmentShown } from "@workspace.sh/table-app";

// One file of a .table, shown in place of a view: what the Files side of
// the sidebar opens. Text as saving writes it, or an attachment's image.

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  breadcrumb: {
    fontSize: 12,
    marginBottom: 2,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  titleRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  note: {
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  back: {
    paddingInline: 10,
    paddingBlock: 5,
    fontSize: 13,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  content: {
    margin: 0,
    padding: 16,
    borderRadius: 8,
    overflow: "auto",
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    whiteSpace: "pre",
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
  },
  image: {
    maxWidth: 240,
    maxHeight: 240,
    borderRadius: 8,
  },
});

interface FileViewProps {
  /** The bundle's name: `crm` for `crm.table`. */
  bundle: string;
  /** The file's path inside `<bundle>.table/`. */
  path: string;
  /** Its text, for a text file. */
  content?: string;
  /** For an attachment: its image, or a note saying why there's none (table-app's attachmentShown). */
  attachment?: AttachmentShown;
  onClose: () => void;
}

export function FileView({ bundle, path, content, attachment, onClose }: FileViewProps) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const folder = path.slice(0, path.length - name.length);
  return (
    <html.div style={styles.root}>
      <html.span style={styles.breadcrumb}>
        {/* A path reads left to right, whichever way the page does. */}
        <html.span dir="ltr">
          {bundle}.table/{folder}
        </html.span>
      </html.span>
      <html.div style={styles.titleRow}>
        <html.span dir="ltr" style={styles.title}>{name}</html.span>
        <html.button style={styles.back} onClick={onClose}>
          Back to the table
        </html.button>
      </html.div>
      <html.span style={styles.note}>
        {attachment
          ? "An attachment: a file the table's rows name, kept beside them."
          : "As saving writes it. Download .table.zip carries the same files."}
      </html.span>
      {attachment && "image" in attachment ? (
        <html.img src={attachment.image} alt={name} style={styles.image} />
      ) : attachment ? (
        <html.span style={styles.note}>{attachment.note}</html.span>
      ) : (
        <html.pre dir="ltr" style={styles.content}>{content ?? ""}</html.pre>
      )}
    </html.div>
  );
}
