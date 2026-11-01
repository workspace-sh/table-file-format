// What a table held over table-app's reducer asks and tells, and a row's
// page: drawn the same way wherever the table is (an embed in a document, a
// .table opened as a document of its own).

import * as Adw from "@gtkx/gi/adw";
import { AdwAlertDialog } from "@gtkx/jsx/adw";
import { rowTitleFor, type AppAction, type AppState } from "@workspace.sh/table-app";
import type { ParsedTable } from "@workspace.sh/table-core";

import { RowPage } from "./RowPage.js";

export function TableDialogs({ state, dispatch, table }: { state: AppState; dispatch: (action: AppAction) => void; table: ParsedTable }) {
  const asking = state.asking;
  return (
    <>
      {state.openPage !== null ? (
        <RowPage
          key={`${state.active}#${state.openPage}`}
          rowId={state.openPage}
          rowTitle={rowTitleFor(table, state.openPage)}
          content={table.bodies?.[state.openPage] ?? ""}
          onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content, table: state.active })}
          onClose={() => dispatch({ type: "openPage", rowId: null })}
        />
      ) : null}
      {asking?.kind === "confirm" ? (
        <AdwAlertDialog
          heading={asking.confirm.heading}
          body={asking.confirm.body}
          closeResponse="cancel"
          defaultResponse="cancel"
          responses={asking.confirm.responses.map((r) => ({
            id: r.id,
            label: r.label,
            ...(r.destructive ? { appearance: Adw.ResponseAppearance.DESTRUCTIVE } : {}),
          }))}
          onResponse={(response) => dispatch({ type: "answer", response })}
        />
      ) : null}
      {state.telling ? (
        <AdwAlertDialog
          heading={state.telling.heading}
          body={state.telling.body}
          closeResponse="ok"
          defaultResponse="ok"
          responses={[{ id: "ok", label: "OK" }]}
          onResponse={() => dispatch({ type: "told" })}
        />
      ) : null}
    </>
  );
}
