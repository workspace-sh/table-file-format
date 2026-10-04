// The tables, file by file (table-app's sidebar tree, as the other apps'
// sidebars list them), in a native sheet over the table on screen.
// Choosing one shows it and closes the sheet. The list is the platform's
// own where it has one (TablesList.ios.tsx).

import { useRouter } from "expo-router";
import { useTableAppContext } from "../TableAppContext";
import { TablesList } from "../TablesList";

export default function TablesScreen() {
  const app = useTableAppContext();
  const router = useRouter();
  if (!app) return null;
  const { state, dispatch, derived } = app;
  return (
    <TablesList
      tree={derived.sidebarTree}
      active={state.active}
      onChoose={(key) => {
        dispatch({ type: "showTable", key });
        router.back();
      }}
      onNewTable={(bundle) => {
        router.back();
        dispatch({ type: "create", making: { kind: "table", bundle } });
      }}
    />
  );
}
