// A box that lets clicks through to what's behind it while its children
// still take theirs (they set `pointer-events: auto`). React Native's is in
// `passThrough.ts`.
import { css } from "react-strict-dom";

const styles = css.create({
  box: { pointerEvents: "none" },
});

export const passThrough = styles.box;
