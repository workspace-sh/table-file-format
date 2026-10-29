import { render, screen } from "@gtkx/testing";
import type { Row, TableSchema, View } from "@workspace.sh/table-core";
import { TableView } from "@workspace.sh/table-gtk";
import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Steady } from "../node_modules/@workspace.sh/table-gtk/src/steady.js";

// Which rows' cells are made again: an edit redraws its own row, not every row built.
const drawn: string[] = [];
vi.mock("../node_modules/@workspace.sh/table-gtk/src/EditableCell.js", async (original) => {
  const module = await original<typeof import("../node_modules/@workspace.sh/table-gtk/src/EditableCell.js")>();
  return {
    ...module,
    EditableCell(props: Parameters<typeof module.EditableCell>[0]) {
      drawn.push(String(props.value));
      return module.EditableCell(props);
    },
  };
});

describe("a table's rows on GTK, drawn again", () => {
  const schema: TableSchema = {
    fields: [
      { name: "title", type: "string" },
      { name: "note", type: "string" },
    ],
  };
  const view: View = { id: "v", name: "All", layout: "table" };
  const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Title ${i}`, note: `Note ${i}` }));
  // As an app gives them: its handlers made again at each render, and its tables (this one among them) new at each edit.
  const table = (shown: Row[]) => (
    <TableView view={view} rows={shown} schema={schema} relatedTables={{ self: { schema, rows: shown, views: [view] } as never }} onUpdateRow={() => {}} onOpenBody={() => {}} />
  );

  it("an edit draws only the row edited again, though every handler given is new", async () => {
    const { rerender } = await render(table(rows));
    await screen.findByText("Title 11");
    drawn.length = 0;
    const edited = rows.map((r) => (r.id === "r3" ? { ...r, title: "Edited" } : r));
    await rerender(table(edited));
    await screen.findByText("Edited");
    expect(drawn.sort()).toEqual(["Edited", "Note 3"]);
  });
});

describe("Steady", () => {
  const box = (label: string, onClick: () => void, also?: object) => createElement("box", { label, onClick, ...also }, createElement("child", { onPick: onClick }));

  it("gives back the element it had when only its handlers are new, and they call the latest", () => {
    const steady = new Steady();
    const calls: string[] = [];
    const first = steady.take(
      "a",
      box("x", () => calls.push("first")),
    );
    const second = steady.take(
      "a",
      box("x", () => calls.push("second")),
    );
    expect(second).toBe(first);
    (first.props as { onClick: () => void }).onClick();
    ((first.props as { children: ReactElement }).children.props as { onPick: () => void }).onPick();
    expect(calls).toEqual(["second", "second"]);
  });

  it("leaves an element given up calling its own handlers: a row going calls the row it was, not the one in its place", () => {
    const steady = new Steady();
    const calls: string[] = [];
    const going = steady.take(
      "a",
      box("row 1", () => calls.push("row 1")),
    );
    steady.take(
      "a",
      box("row 2", () => calls.push("row 2")),
    );
    (going.props as { onClick: () => void }).onClick();
    expect(calls).toEqual(["row 1"]);
  });

  it("gives the new element when what it shows changed, or what its refs read", () => {
    const steady = new Steady();
    const first = steady.take(
      "a",
      box("x", () => {}),
      1,
    );
    expect(
      steady.take(
        "a",
        box("y", () => {}),
        1,
      ),
    ).not.toBe(first);
    const third = steady.take(
      "a",
      box("y", () => {}),
      1,
    );
    expect(
      steady.take(
        "a",
        box("y", () => {}),
        2,
      ),
    ).not.toBe(third);
    // A ref is no handler: a new one isn't compared, nor swapped for a stand-in.
    const ref = () => {};
    const withRef = steady.take(
      "b",
      box("x", () => {}, { cellRef: ref }),
    );
    expect((withRef.props as { cellRef: unknown }).cellRef).toBe(ref);
    expect(
      steady.take(
        "b",
        box("x", () => {}, { cellRef: () => {} }),
      ),
    ).toBe(withRef);
    // Values deep in a prop are compared too.
    const deep = steady.take(
      "c",
      box("x", () => {}, { formula: { own: "a" } }),
    );
    expect(
      steady.take(
        "c",
        box("x", () => {}, { formula: { own: "b" } }),
      ),
    ).not.toBe(deep);
  });
});
