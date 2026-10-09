// The sidebar, as the system draws one: a SwiftUI List in the sidebar style,
// in the window's sidebar split item (TableShell.swift), so it has the
// system's material (Liquid Glass on macOS 26), row sizes, selection and
// accent colour. What it lists is table-app's own sidebar data, sent from
// JS as JSON (TableSidebarBridge.swift); a click goes back as an event and
// the app decides what it does. Nothing here knows what a table is. Which
// side shows, tables or files, is chosen in the toolbar above it
// (TableToolbar.swift).

import AppKit
import SwiftUI

struct SidebarViewRow: Decodable, Identifiable {
  let id: String
  let name: String
  let layout: String
  let layoutLabel: String
  let active: Bool
}

struct SidebarTableRow: Decodable, Identifiable {
  let key: String
  let title: String
  let rowCount: Int
  let expanded: Bool
  /// The table on screen.
  let active: Bool
  let views: [SidebarViewRow]
  var id: String { key }
}

struct SidebarBundleRow: Decodable, Identifiable {
  let bundle: String
  let title: String
  let file: String
  let folded: Bool
  let tables: [SidebarTableRow]
  let offersNewTable: Bool
  var id: String { bundle }
}

/// A line of Files mode: a `.table` folder, a folder inside it, or a file.
struct SidebarFileRow: Decodable, Identifiable {
  let id: String
  let kind: String
  let bundle: String
  let path: String
  let name: String
  let depth: Int
  let open: Bool
  let note: String?
  let selected: Bool
  let image: Bool
}

struct SidebarModelData: Decodable {
  let filesMode: Bool
  let bundles: [SidebarBundleRow]
  let files: [SidebarFileRow]
  let tablesLabel: String
  let filesLabel: String
  let newViewLabel: String
  let newTableLabel: String
}

final class TableSidebarModel: ObservableObject {
  @Published var data = SidebarModelData(
    filesMode: false, bundles: [], files: [],
    tablesLabel: "Tables", filesLabel: "Files", newViewLabel: "New View", newTableLabel: "New Table")
  /// A click, as an event for JS: its name and what it was on.
  var send: (String, [String: Any]) -> Void = { _, _ in }
}

/// The symbol for a view's layout.
private func layoutSymbol(_ layout: String) -> String {
  switch layout {
  case "board": return "rectangle.split.3x1"
  case "gallery": return "square.grid.2x2"
  case "list": return "list.bullet"
  case "calendar": return "calendar"
  default: return "tablecells"
  }
}

private func fileSymbol(_ row: SidebarFileRow) -> String {
  if row.kind == "bundle" { return "tablecells" }
  if row.kind == "dir" { return "folder" }
  if row.image { return "photo" }
  return "doc.text"
}

struct TableSidebarView: View {
  @ObservedObject var model: TableSidebarModel

  var body: some View {
    Group {
      if model.data.filesMode {
        files
      } else {
        tables
      }
    }
    .listStyle(.sidebar)
  }

  /// The row on screen: a view of the table shown, or the table itself.
  private var selection: String? {
    for bundle in model.data.bundles {
      for table in bundle.tables where table.active {
        if let view = table.views.first(where: { $0.active }) { return "view:\(table.key):\(view.id)" }
        return "table:\(table.key)"
      }
    }
    return nil
  }

  private var tables: some View {
    List(selection: Binding<String?>(
      get: { selection },
      set: { picked in
        guard let picked, picked != selection else { return }
        let parts = picked.split(separator: ":", maxSplits: 2).map(String.init)
        if parts.first == "table", parts.count == 2 {
          model.send("selectTable", ["key": parts[1]])
        } else if parts.first == "view", parts.count == 3 {
          model.send("selectView", ["key": parts[1], "viewId": parts[2]])
        }
      }
    )) {
      ForEach(model.data.bundles) { bundle in
        Section(isExpanded: Binding(
          get: { !bundle.folded },
          set: { _ in model.send("toggleFile", ["bundle": bundle.bundle]) }
        )) {
          ForEach(bundle.tables) { table in
            Label(table.title, systemImage: "tablecells")
              .badge(table.rowCount)
              .tag("table:\(table.key)")
            ForEach(table.views) { view in
              Label(view.name, systemImage: layoutSymbol(view.layout))
                .padding(.leading, 16)
                .help(view.layoutLabel)
                .tag("view:\(table.key):\(view.id)")
            }
            if table.expanded {
              Button {
                model.send("newView", [:])
              } label: {
                Label(model.data.newViewLabel, systemImage: "plus")
                  .padding(.leading, 16)
                  .foregroundStyle(.secondary)
              }
              .buttonStyle(.plain)
              .selectionDisabled()
            }
          }
          if bundle.offersNewTable {
            Button {
              model.send("newTable", [:])
            } label: {
              Label(model.data.newTableLabel, systemImage: "plus")
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .selectionDisabled()
          }
        } header: {
          Text(bundle.title).help(bundle.file)
        }
      }
    }
  }

  private var files: some View {
    List(selection: Binding<String?>(
      get: { model.data.files.first(where: { $0.selected })?.id },
      set: { picked in
        guard let picked, let row = model.data.files.first(where: { $0.id == picked }) else { return }
        if row.kind == "file" {
          model.send("showFile", ["bundle": row.bundle, "path": row.path])
        } else if row.kind == "dir" {
          model.send("toggleDir", ["bundle": row.bundle, "path": row.path, "open": !row.open])
        } else {
          model.send("toggleFile", ["bundle": row.bundle])
        }
      }
    )) {
      ForEach(model.data.files) { row in
        HStack(spacing: 6) {
          if row.kind != "file" {
            Image(systemName: row.open ? "chevron.down" : "chevron.forward")
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.tertiary)
              .frame(width: 10)
          } else {
            Spacer().frame(width: 10)
          }
          Label(row.name, systemImage: fileSymbol(row))
            .font(.system(.body, design: .monospaced))
          Spacer(minLength: 4)
          if let note = row.note {
            Text(note).font(.caption).foregroundStyle(.secondary)
          }
        }
        .padding(.leading, CGFloat(row.depth) * 14)
        .tag(row.id)
      }
    }
  }
}
