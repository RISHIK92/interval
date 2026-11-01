// Q-P3-07 (owner, 2026-10-31 and 2026-11-01): the daily challenge's streak counts
// consecutive UTC days with a finished challenge. Every 7th day played earns a freeze,
// at most 1 held, which covers one missed day; the covered day doesn't count. A gap a
// freeze can't cover resets the streak and leaves the freeze held. Today not played
// yet breaks nothing.
const EARN_EVERY = 7;
const MAX_FREEZES = 1;
const DAY_MS = 86_400_000;

const dayNumber = (day: string): number =>
  Date.parse(`${day}T00:00:00Z`) / DAY_MS;

export function dailyStreak(
  daysPlayed: string[],
  today: string,
): { days: number; freezes: number } {
  const played = [...new Set(daysPlayed.map(dayNumber))].sort((a, b) => a - b);
  let days = 0;
  let freezes = 0;
  // A gap of missed days: true when the streak survives it.
  const survives = (missed: number): boolean => {
    if (missed <= 0) return true;
    if (missed > freezes) return false;
    freezes -= missed;
    return true;
  };
  const last = played.at(-1);
  if (last === undefined) return { days: 0, freezes: 0 };
  played.forEach((day, index) => {
    const before = played[index - 1];
    if (before !== undefined && !survives(day - before - 1)) days = 0;
    days += 1;
    if ((index + 1) % EARN_EVERY === 0)
      freezes = Math.min(MAX_FREEZES, freezes + 1);
  });
  // Up to yesterday: today still has time.
  return survives(dayNumber(today) - last - 1)
    ? { days, freezes }
    : { days: 0, freezes };
}
