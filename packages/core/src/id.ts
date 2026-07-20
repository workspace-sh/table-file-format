import { customAlphabet } from "nanoid";

/**
 * Case-safe id alphabet: lowercase + digits only (base36).
 *
 * Row ids are used verbatim as filenames (`bodies/{id}.md`), and the
 * default nanoid alphabet mixes upper and lower case — on
 * case-insensitive filesystems (default APFS, NTFS, most sync
 * targets) two ids differing only in letter case resolve to the SAME
 * path, silently overwriting one row's body with another's. Excluding
 * case from the alphabet removes the failure class entirely instead
 * of papering over it with a filename-encoding layer.
 *
 * Length 25 keeps entropy at ~129 bits (25 × log2(36)), comfortably
 * above the ~125 bits of the 21-char default. See SPEC section 3 and
 * DECISIONS D23.
 */
export const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 25;

const generate = customAlphabet(ID_ALPHABET, ID_LENGTH);

export function newId(): string {
  return generate();
}
