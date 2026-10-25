// The ids this repository's fixtures are given (D23): 26 z-base-32
// characters from a name for the id, the first 130 bits of its SHA-256. The
// same name gives the same id on every run, in every script, so a generated
// fixture and one rewritten by zbase32-ids.mts agree: `row/b1` is one id.

import { createHash } from "node:crypto";
import { ID_ALPHABET, ID_LENGTH } from "../packages/core/src/id.ts";

export function fixtureId(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  let bits = 0n;
  for (const b of digest.subarray(0, 17)) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) out += ID_ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
  return out;
}
