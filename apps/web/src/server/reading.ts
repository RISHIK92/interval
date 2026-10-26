// "Now reading" (C-22, P1-W5-S02): /out remembers the card a reader opened, for the
// feed's panel. A session cookie of ids only; the page looks them up again.
export const READING_COOKIE = "iv_reading";

export type Reading = { itemId: string; momentId: string | null };

const READING = /^([1-9][0-9]{0,18})\.([1-9][0-9]{0,18})?$/;

export function formatReading(reading: Reading): string {
  return `${reading.itemId}.${reading.momentId ?? ""}`;
}

export function parseReading(value: string | undefined): Reading | null {
  const match = value === undefined ? null : READING.exec(value);
  if (match === null) return null;
  const [, itemId, momentId] = match;
  return itemId === undefined ? null : { itemId, momentId: momentId ?? null };
}
