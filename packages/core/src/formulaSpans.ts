// Colouring a formula as it is typed: where its references, functions,
// strings, numbers and operators are. Unlike compiling, this never refuses:
// a half-typed formula (an open quote, a missing bracket) still colours up
// to where it stops.

/** A stretch of a formula, by UTF-16 offsets (JavaScript's string indices). */
export interface FormulaSpan {
  start: number;
  end: number;
  kind: "ref" | "fn" | "str" | "num" | "op";
}

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*/u;
const OPS = ["<=", ">=", "<>", "!=", "==", "=", "<", ">", "+", "-", "*", "/", "&", "(", ")", ",", ":", "^", "%"];
const LITERALS = new Set(["true", "false", "nil"]);

export function formulaSpans(src: string): FormulaSpan[] {
  const out: FormulaSpan[] = [];
  let i = 0;
  // Up to the closing `close` (Excel's doubled quote escapes one), or the end.
  const closing = (from: number, close: string): number => {
    let j = from + 1;
    while (j < src.length) {
      if (src[j] === close) {
        if (close !== "]" && close !== "}" && src[j + 1] === close) {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return src.length;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const end = closing(i, '"');
      out.push({ start: i, end, kind: "str" });
      i = end;
      continue;
    }
    // {name}, [name] and 'Sheet'!C6 are references.
    if (c === "{" || c === "[" || c === "'") {
      let end = closing(i, c === "{" ? "}" : c === "[" ? "]" : "'");
      if (c === "'" && src[end] === "!") {
        const cell = IDENT.exec(src.slice(end + 1));
        end += 1 + (cell ? cell[0].length : 0);
      }
      out.push({ start: i, end, kind: "ref" });
      i = end;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER.exec(rest);
    if (num) {
      out.push({ start: i, end: i + num[0].length, kind: "num" });
      i += num[0].length;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      const end = i + ident[0].length;
      let after = end;
      while (after < src.length && src[after] === " ") after++;
      const kind = src[after] === "(" ? "fn" : LITERALS.has(ident[0].toLowerCase()) ? "num" : "ref";
      out.push({ start: i, end, kind });
      i = end;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      out.push({ start: i, end: i + op.length, kind: "op" });
      i += op.length;
      continue;
    }
    i++;
  }
  return out;
}
