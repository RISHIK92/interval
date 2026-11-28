// "Now reading" (C-22, P1-W5-S02): /out remembers the article a reader opened, for the
// feed's panel. A session cookie of its id only; the page looks it up again.
export const READING_COOKIE = "iv_reading";

// ADR-0058: an article only. A cookie set before it ("item.moment") still names its
// article, so it is read as that article.
const READING = /^([1-9][0-9]{0,18})(?:\.(?:[1-9][0-9]{0,18})?)?$/;

export function parseReading(value: string | undefined): string | null {
  const match = value === undefined ? null : READING.exec(value);
  return match?.[1] ?? null;
}
