#!/bin/sh
# Checks the glass bar's Swift formula scanner (ios/FormulaFieldView.swift)
# against the cases core's TypeScript scanner is tested with
# (packages/core/src/formulaSpans.cases.json), so the two can't drift.
# Needs a Swift toolchain (macOS with Xcode). Exits non-zero on a mismatch.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
{
  echo "import Foundation"
  sed -n '/^enum FormulaScanner/,$p' "$root/packages/glass-bar/ios/FormulaFieldView.swift"
  cat <<'SWIFT'
struct Case: Decodable { let why: String; let formula: String; let spans: [String] }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
var failed = 0
for c in cases {
  let got = FormulaScanner.spans(c.formula).map { "\($0.1):" + (c.formula as NSString).substring(with: $0.0) }
  if got != c.spans {
    failed += 1
    print("✖ \(c.why)\n  want \(c.spans)\n  got  \(got)")
  }
}
print(failed == 0 ? "✔ \(cases.count) cases match" : "✖ \(failed) of \(cases.count) differ")
exit(failed == 0 ? 0 : 1)
SWIFT
} > "$work/check.swift"
swift "$work/check.swift" "$root/packages/core/src/formulaSpans.cases.json"
