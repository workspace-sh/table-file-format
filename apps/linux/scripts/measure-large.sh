#!/usr/bin/env bash
# How long a large table takes in the built app (#442, docs/LARGE-TABLES.md):
# opened twice on a headless compositor, first with no index (it's made),
# then again (the index as it was). The app times itself (src/measure.ts).
#
#   npx tsx ../../scripts/big-table.mts 100000 /tmp/big
#   npm run build
#   ./scripts/measure-large.sh /tmp/big/big-100000.table
#
#   SIZE=1280x800     output resolution
#   NODE_ARGS=...     given to node, as --cpu-prof --cpu-prof-dir=/tmp/prof to see where its time goes
#
# The table is copied first, so it's left as it was: no index, no edit.
# Needs sway: sudo dnf install sway
set -euo pipefail

SOURCE="${1:?usage: measure-large.sh <a .table folder from scripts/big-table.mts>}"
SIZE="${SIZE:-1280x800}"
NODE_ARGS="${NODE_ARGS:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$HERE/dist/bundle.mjs"
[ -f "$BUNDLE" ] || { echo "no build at $BUNDLE — run: npm run build" >&2; exit 1; }
command -v sway >/dev/null || { echo "sway not installed: sudo dnf install sway" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TABLE="$WORK/$(basename "$SOURCE")"
cp -r "$SOURCE" "$TABLE"
rm -f "$TABLE"/index.sqlite*

# The first row's id, as big-table.mts names it: the edit is made to it.
ROW="$(cd "$HERE/../.." && npx tsx -e 'import("./scripts/fixture-ids.mts").then((m) => console.log(m.fixtureId("row/d0")))')"

run() {
  local log="$WORK/app-$1.log"
  {
    echo "output HEADLESS-1 mode $SIZE"
    echo "default_border none"
    # Its own data folder: nothing of this user's is read or changed.
    printf 'exec sh -c %q\n' "env XDG_DATA_HOME=$WORK/data XDG_CACHE_HOME=$WORK/cache ADW_DEBUG_COLOR_SCHEME=prefer-dark TABLE_MEASURE=1 TABLE_MEASURE_RUN=$1 TABLE_MEASURE_ROW=$ROW node $NODE_ARGS $BUNDLE $TABLE > $log 2>&1; swaymsg exit"
  } > "$WORK/sway.conf"
  WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
    timeout 3600 sway -c "$WORK/sway.conf" > "$WORK/sway.log" 2>&1 || true
  grep "^\[measure\]" "$log" || { echo "no timings. app log:" >&2; grep -viE 'libEGL|MESA|Vulkan|vkGet' "$log" >&2 || true; exit 1; }
}

echo "== $(basename "$SOURCE"), opened with no index"
run first
echo "== opened again"
run again
