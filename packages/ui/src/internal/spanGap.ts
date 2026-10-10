/**
 * Native default (the web has `spanGap.web.ts`): the space before text
 * that sits inside other text. A browser spaces a span inside a flex span
 * by its `gap`; React Native draws both as one run of text, where neither
 * a gap nor a margin applies, so the space is in the text itself: an en
 * space and a thin space, about 8 points at a group heading's size.
 */
export const SPAN_GAP = "  ";
