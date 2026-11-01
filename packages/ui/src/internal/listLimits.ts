/** The tallest a list is laid out as it is: a browser stops placing things some millions of pixels down. A taller one is given its `layout` (RowList). */
export const MAX_LIST_HEIGHT = 8_000_000;

/**
 * The tallest a native list is laid out as it is. The layout engine keeps
 * positions as 32-bit floats, which 45 million points down are only good
 * to 4; RowList.native moves its rows there with a transform, which isn't
 * laid out, so they're exact. A million rows at the standard height is 45
 * million points, checked on iOS; past this the page is mapped onto the
 * list, as the web does past MAX_LIST_HEIGHT.
 */
export const NATIVE_MAX_LIST_HEIGHT = 64_000_000;
