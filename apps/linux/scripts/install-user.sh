#!/usr/bin/env bash
# Make this checkout's build the app that opens .table files, for this user
# only (#621): a double-click on a single-file .table opens it, with the file's
# icon, and the app is in the app grid. A .table folder is a folder to a file
# manager (SPEC section 13), so it is opened from its menu: Open With → Table.
#
#   npm run build && ./scripts/install-user.sh
#   ./scripts/install-user.sh --uninstall
#
# Writes under $XDG_DATA_HOME (~/.local/share) and $XDG_CONFIG_HOME/mimeapps.list
# (~/.config); nothing needs root. Run it again after moving the checkout.
set -euo pipefail

ID="sh.workspace.TableDemo"
TYPE="application/vnd.workspace-sh.table"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
APPS="$DATA/applications"
MIME="$DATA/mime"
ICONS="$DATA/icons/hicolor"
LIST="$CONFIG/mimeapps.list"

refresh() {
  update-mime-database "$MIME" >/dev/null
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -f -t "$ICONS" 2>/dev/null || true
}

# This app in mimeapps.list's [Added Associations] for folders: offered by a
# file manager's Open With, after whatever is there already, never the default.
offer_for_folders() {
  mkdir -p "$CONFIG"
  touch "$LIST"
  local tmp="$LIST.tmp"
  awk -v app="$ID.desktop" '
    function add() { print "inode/directory=" app ";"; added = 1 }
    /^\[/ { if (inside && !added) add(); inside = ($0 == "[Added Associations]"); seen = seen || inside; print; next }
    inside && /^inode\/directory=/ {
      added = 1
      if (index($0, app)) { print; next }
      line = $0; if (line !~ /;$/) line = line ";"
      print line app ";"; next
    }
    { print }
    END {
      if (inside && !added) add()
      if (!seen) { print ""; print "[Added Associations]"; print "inode/directory=" app ";" }
    }
  ' "$LIST" > "$tmp"
  mv "$tmp" "$LIST"
}

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$APPS/$ID.desktop" "$MIME/packages/$ID.xml" "$ICONS/scalable/apps/$ID.svg" "$ICONS/scalable/mimetypes/${TYPE//\//-}.svg"
  if [ -f "$LIST" ]; then
    # This app's entries out of every list, and lines left with none.
    sed -i -e "s/$ID\.desktop;\?//g" -e '/^[^=[]*=$/d' "$LIST"
  fi
  [ -d "$MIME/packages" ] && refresh
  echo "Removed. A .table opens with whatever opened it before."
  exit 0
fi

BUNDLE="$HERE/dist/bundle.mjs"
[ -f "$BUNDLE" ] || { echo "no build at $BUNDLE: run npm run build first" >&2; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node isn't on PATH (Node 24 is needed)" >&2; exit 1; }
major="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 24 ] || { echo "node $major is too old: Node 24 is needed" >&2; exit 1; }

mkdir -p "$APPS" "$MIME/packages" "$ICONS/scalable/apps" "$ICONS/scalable/mimetypes" "$CONFIG"
# Exec's arguments quoted, as the Desktop Entry spec quotes them.
quote() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/[\\"`$]/\\&/g')"; }
exec_line="$(quote "$NODE") $(quote "$BUNDLE")"
# The & in a sed replacement means the match: escaped, with / and \.
sed "s|@EXEC@|$(printf '%s' "$exec_line" | sed -e 's/[\\|&]/\\&/g')|" "$HERE/packaging/$ID.desktop" > "$APPS/$ID.desktop"
cp "$HERE/packaging/$ID.xml" "$MIME/packages/$ID.xml"
cp "$HERE/packaging/$ID.svg" "$ICONS/scalable/apps/$ID.svg"
cp "$HERE/packaging/${TYPE//\//-}.svg" "$ICONS/scalable/mimetypes/${TYPE//\//-}.svg"
refresh
xdg-mime default "$ID.desktop" "$TYPE"

# Folders: offered, never the default. Where no list names what opens folders
# (Arch, say), the first association would become it, so what opens them now
# is written down as the default first. Checked as GIO, which file managers
# use, sees it; if it still changed, the offer is taken back.
folder_default() { gio mime inode/directory 2>/dev/null | sed -n 's/^Default application for .*: //p'; }
before="$(folder_default)"
folders="A .table folder: no file manager opens folders here, so Table isn't offered for them; open one from Table's Open."
if [ -n "$before" ] && [ "$before" != "$ID.desktop" ]; then
  offer_for_folders
  if [ "$(folder_default)" != "$before" ]; then
    gio mime inode/directory "$before" >/dev/null
  fi
  if [ "$(folder_default)" = "$before" ]; then
    folders="A .table folder: right-click it, Open With → Table. Folders still open with $before."
  else
    sed -i -e "s/$ID\.desktop;\?//g" -e '/^[^=[]*=$/d' "$LIST"
  fi
fi

echo "Installed for $(id -un): Table opens .table files ($TYPE)."
echo "$folders"
echo "It runs $BUNDLE with $NODE."
