import type * as Gtk from "@gtkx/gi/gtk";
import { userEvent } from "@gtkx/testing";

/**
 * Click what `find` finds, finding it again if the screen drew it anew in
 * between: a widget found just before a redraw (a save landing, the index
 * answering) is no longer in the window, and clicking it fails with "not
 * inside a toplevel" (#649). Any other failure is the test's.
 */
export async function clickFresh(find: () => Promise<Gtk.Widget>, tries = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const widget = await find();
    try {
      await userEvent.click(widget);
      return;
    } catch (error) {
      if (attempt >= tries || !(error instanceof Error) || !/not inside a toplevel/.test(error.message)) throw error;
    }
  }
}
