import * as Gtk from "@gtkx/gi/gtk";
import { waitFor } from "@gtkx/testing";
import { expect } from "vitest";

/**
 * A row's menu as a right-click on the row makes it: the menu is built only
 * once it's opened, so a test reads it after opening it (and closes it again).
 */
export async function openedRowMenu(button: Gtk.MenuButton): Promise<Gtk.PopoverMenu> {
  if (!button.getPopover()) {
    const controllers = button.getParent()!.observeControllers();
    for (let i = 0; i < controllers.getNItems(); i++) {
      const c = controllers.getItem(i);
      if (c instanceof Gtk.GestureClick && c.getButton() === 3) c.emit("pressed", 1, 0, 0);
    }
  }
  await waitFor(() => expect(button.getPopover()).toBeTruthy());
  const popover = button.getPopover() as Gtk.PopoverMenu;
  popover.popdown();
  return popover;
}
