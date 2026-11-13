// P5-W32 (§6.6, MATCH-7; Q-P5-12, Q-P5-19): ranked battle windows, nightly at 21:00 in
// the deployment's zone plus 11:00 on Saturday and Sunday, 45 minutes each.
// Registration closes 5 minutes before a window; its reminder goes 15 minutes before.
// The schedule lives only here: a registration stores its reminder's time, so the
// worker that sends it never computes a window (ARCH-2).

export const WINDOW_MINUTES = 45;
export const CLOSES_BEFORE_MINUTES = 5;
export const REMIND_BEFORE_MINUTES = 15;
const NIGHTLY_HOUR = 21;
const WEEKEND_HOUR = 11;
const MINUTE = 60_000;

// The zone's offset from UTC at an instant, in ms.
function offset(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, Number(p.value)]),
  );
  const local = Date.UTC(
    parts["year"] ?? 0,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
  return local - (at - (at % 1000));
}

// A local wall time in the zone as an instant (checked twice, for a DST change).
function zoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month, day, hour);
  const first = wall - offset(wall, timeZone);
  return new Date(wall - offset(first, timeZone));
}

// The windows that haven't ended at `now`, soonest first: the live one, if any, then
// the next ones over about a week.
export function windowsFrom(now: Date, timeZone: string): Date[] {
  const local = new Date(now.getTime() + offset(now.getTime(), timeZone));
  const out: Date[] = [];
  for (let d = -1; d <= 7; d++) {
    const day = new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + d,
      ),
    );
    const [y, m, dd] = [
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
    ];
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    if (weekend) out.push(zoned(y, m, dd, WEEKEND_HOUR, timeZone));
    out.push(zoned(y, m, dd, NIGHTLY_HOUR, timeZone));
  }
  return out.filter(
    (w) => w.getTime() + WINDOW_MINUTES * MINUTE > now.getTime(),
  );
}

export type WindowStatus = "open" | "closed" | "live";

export function windowStatus(windowAt: Date, now: Date): WindowStatus {
  const t = now.getTime();
  const start = windowAt.getTime();
  if (t >= start) return "live";
  return t < start - CLOSES_BEFORE_MINUTES * MINUTE ? "open" : "closed";
}

export function remindAt(windowAt: Date): Date {
  return new Date(windowAt.getTime() - REMIND_BEFORE_MINUTES * MINUTE);
}

// Q-P5-19: by room rating, best first, into rooms of 4; a remainder of 3 is a room of
// 3 and 2 a 1v1, and 1 plays solo, unranked.
export function group<T>(byRating: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < byRating.length; i += 4)
    out.push(byRating.slice(i, i + 4));
  return out;
}
