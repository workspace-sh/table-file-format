import { useEffect, useRef } from "react";
import { html, css } from "react-strict-dom";

// A cell's file, opened: an image at the size of the window, or the file's
// name when it isn't one, with Replace… and Remove beside Done. The web's
// counterpart of the iPhone's image viewer and the Mac's Quick Look menu
// (#813): the views hand a cell's file to the app (onAttachFile), and this
// is how the web shows it.

const styles = css.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#000000",
    color: "#f5f5f7",
  },
  bar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingInline: 16,
    paddingBlock: 12,
  },
  name: {
    flexGrow: 1,
    minWidth: 0,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    opacity: 0.8,
  },
  button: {
    paddingInline: 12,
    paddingBlock: 6,
    fontSize: 13,
    borderRadius: 6,
    borderWidth: 0,
    cursor: "pointer",
    color: "#f5f5f7",
    backgroundColor: {
      default: "rgba(255, 255, 255, 0.14)",
      ":hover": "rgba(255, 255, 255, 0.24)",
    },
  },
  remove: {
    color: "#ff6961",
  },
  done: {
    fontWeight: "600",
  },
  stage: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingInline: 16,
    paddingBottom: 16,
  },
  // As large as the window allows, its shape kept: a small picture is drawn larger, as the iPhone's viewer does.
  image: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  file: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    textAlign: "center",
  },
  fileName: {
    fontSize: 17,
    fontWeight: "600",
    wordBreak: "break-all",
  },
  fileNote: {
    fontSize: 13,
    opacity: 0.7,
  },
});

interface AttachmentViewerProps {
  /** The file's name, as the cell holds it. */
  name: string;
  /** Where its image is drawn from; absent when it isn't an image, or isn't here. */
  image?: string;
  /** Why there's no image, when there isn't one. */
  note?: string;
  onReplace: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function AttachmentViewer({ name, image, note, onReplace, onRemove, onClose }: AttachmentViewerProps) {
  const done = useRef<HTMLButtonElement | null>(null);
  // Escape closes it, as it closes the app's other panels; the keyboard starts on Done.
  useEffect(() => {
    done.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <html.div role="dialog" aria-modal={true} aria-label={name} style={styles.backdrop}>
      <html.div style={styles.bar}>
        <html.span style={styles.name}>{name}</html.span>
        <html.button style={styles.button} onClick={onReplace}>
          Replace…
        </html.button>
        <html.button style={[styles.button, styles.remove]} onClick={onRemove}>
          Remove
        </html.button>
        <html.button ref={done} style={[styles.button, styles.done]} onClick={onClose}>
          Done
        </html.button>
      </html.div>
      {/* A click on the dark around the picture closes it; on the picture itself, nothing. */}
      <html.div style={styles.stage} onClick={onClose}>
        {image ? (
          <html.img src={image} alt={name} style={styles.image} onClick={(e) => e.stopPropagation()} />
        ) : (
          <html.div style={styles.file} onClick={(e) => e.stopPropagation()}>
            <html.span style={styles.fileName}>{name}</html.span>
            {note ? <html.span style={styles.fileNote}>{note}</html.span> : null}
          </html.div>
        )}
      </html.div>
    </html.div>
  );
}
