#!/usr/bin/env bash
# Files whose paths differ only in case collide on a case-insensitive disk
# (macOS, Windows). So do modules whose paths differ only in case once the
# extension is gone: an import of "./FieldHint" can resolve to
# fieldHint.ts before FieldHint.tsx there. Fails listing any such pair.
set -euo pipefail
found=$(git ls-files | sed -E 's/\.(tsx?|jsx?|mts|cts|mjs|cjs)$//' | tr '[:upper:]' '[:lower:]' | sort | uniq -d)
if [ -n "$found" ]; then
  echo "Paths that collide on a case-insensitive disk (compared without case or JS/TS extension):"
  echo "$found"
  exit 1
fi
echo "No case collisions."
