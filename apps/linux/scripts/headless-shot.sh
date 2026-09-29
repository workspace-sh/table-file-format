#!/usr/bin/env bash
# Run the built app on a headless compositor and capture a PNG.
#
# This exists because the app cannot be seen from the machine most of its code
# is likely to be written on: GTK4 and libadwaita are Linux, so a change made
# on macOS is unverifiable there. One command here turns "it compiles" into a
# picture, which is the only way a visual claim gets checked.
#
#   ./scripts/headless-shot.sh out.png [file-or-folder ...]
#
#   SIZE=1280x800     output resolution
#   SCHEME=dark       force a colour scheme (default: light)
#   WAIT=11           seconds before the grab; raise it for a slow first paint
#
# Needs sway and grim: sudo dnf install sway grim
set -euo pipefail

OUT="${1:?usage: headless-shot.sh out.png [file-or-folder ...]}"
shift || true
SIZE="${SIZE:-1280x800}"
SCHEME="${SCHEME:-light}"
WAIT="${WAIT:-11}"

command -v sway >/dev/null || { echo "sway not installed: sudo dnf install sway grim" >&2; exit 1; }
command -v grim >/dev/null || { echo "grim not installed: sudo dnf install sway grim" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$HERE/dist/bundle.mjs"
[ -f "$BUNDLE" ] || { echo "no build at $BUNDLE — run: npm run build" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

# The app is launched *by* sway rather than beside it, so it inherits the
# right WAYLAND_DISPLAY. Setting that variable before sway starts does not
# work: sway picks its own socket name.
{
  echo "output HEADLESS-1 mode $SIZE"
  echo "default_border none"
  printf 'exec env ADW_DEBUG_COLOR_SCHEME=prefer-%s node %q' "$SCHEME" "$BUNDLE"
  for arg in "$@"; do printf ' %q' "$arg"; done
  printf ' > %q 2>&1\n' "$WORK/app.log"
  printf "exec sh -c 'sleep %s; grim -o HEADLESS-1 %q; swaymsg exit'\n" "$WAIT" "$OUT"
} > "$WORK/sway.conf"

WLR_BACKENDS=headless \
WLR_LIBINPUT_NO_DEVICES=1 \
WLR_RENDERER=pixman \
XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  timeout $((WAIT + 40)) sway -c "$WORK/sway.conf" >"$WORK/sway.log" 2>&1 || true

if [ ! -s "$OUT" ]; then
  echo "no screenshot produced. app log:" >&2
  # The GPU warnings are expected under the software renderer and drown
  # everything else, so they are filtered rather than shown.
  grep -viE 'libEGL|MESA|Vulkan|vkGet' "$WORK/app.log" >&2 || true
  exit 1
fi

echo "$OUT"
grep -viE 'libEGL|MESA|Vulkan|vkGet' "$WORK/app.log" | grep -iE 'error|warn' >&2 || true
