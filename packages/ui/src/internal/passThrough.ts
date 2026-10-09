// A box that lets clicks through to what's behind it while its children
// still take theirs: a wrapper that only centres a card over a backdrop.
// React Native's `none` silences the children too (a click on the card went
// to the backdrop, which closed it), so here it is `box-none`. The web's is
// in `passThrough.web.ts`.
import { css } from "react-strict-dom";

const styles = css.create({
  // React Native's own value; react-strict-dom hands it on as it is.
  box: { pointerEvents: "box-none" as "none" },
});

export const passThrough = styles.box;
