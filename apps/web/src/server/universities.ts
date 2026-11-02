// P3-W14-S03 (ADR-0032): a typed university's name shows on public boards at once, so
// it is tidied and checked where it comes in: 2 to 120 characters as Postgres counts
// them (code points), and no control or invisible characters (bidi overrides,
// zero-width spaces, NUL), which could spoof or garble a listed name.
export function universityName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  const length = [...name].length;
  return length >= 2 && length <= 120 && !/\p{C}/u.test(name) ? name : null;
}
