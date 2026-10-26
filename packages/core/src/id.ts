import { customAlphabet } from "nanoid";

/**
 * The id alphabet: z-base-32 (D23, D62), lowercase only, built for people
 * to read (no look-alikes such as 0/o or 1/l), and the alphabet Workspace
 * and Holepunch write keys and invite codes in.
 *
 * Lowercase matters: row ids are used verbatim as filenames
 * (`bodies/{id}.md`), and on case-insensitive filesystems (default APFS,
 * NTFS, most sync targets) two ids differing only in letter case resolve
 * to the SAME path, silently overwriting one row's page with another's.
 *
 * 26 characters is 130 bits, above the ~125 of nanoid's 21-character
 * default. 32 is a power of two, so every character is equally likely.
 * See SPEC section 3 and DECISIONS D23.
 */
export const ID_ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";
export const ID_LENGTH = 26;

const generate = customAlphabet(ID_ALPHABET, ID_LENGTH);

export function newId(): string {
  return generate();
}

/**
 * A field's `id` (D62): 13 characters from the same alphabet, 65 bits. It
 * only has to be unique among one table's fields, even when two devices add
 * one at the same moment, and it travels in links, so it's shorter than a
 * row's.
 */
export const FIELD_ID_LENGTH = 13;

const generateFieldId = customAlphabet(ID_ALPHABET, FIELD_ID_LENGTH);

/** A new field's id, as an app adds one: random, so two people adding "notes" on two devices make two fields. */
export function newFieldId(): string {
  return generateFieldId();
}

/** A counter in the id alphabet: `0` is `y`, `31` is `9`, `32` is `by`. For ids made in order, such as a generated table's `d` + n. */
export function idNumber(n: number): string {
  let out = "";
  do {
    out = ID_ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return out;
}
