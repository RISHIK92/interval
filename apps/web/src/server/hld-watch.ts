import type { HldMatches, HldTournaments } from "./ports";

// P6-W44 (§6.4, Q-P6-08): who may see a match's designs. Its players replay it once it's
// over. A tournament match can be watched live by anyone not playing in that round
// (they'd share its problem), and replayed by anyone once the round is over. Casual and
// window matches stay with their players.
export type Access = "live" | "replay" | null;

export async function accessTo(
  deps: { matches: HldMatches; tournaments: HldTournaments },
  matchId: string,
  userId: string,
): Promise<Access> {
  const found = await deps.matches.get(matchId);
  if (found === null) return null;
  const over = found.match.closedAt !== null;
  if (found.seats.some((s) => s.userId === userId))
    return over ? "replay" : null;
  const round = await deps.tournaments.roundOf(matchId);
  if (round === null) return null;
  if (round.over) return "replay";
  if (round.players.includes(userId)) return null;
  return over ? "replay" : "live";
}

// A replay's versions, thinned to at most `max` per player (always keeping the last),
// so a 900-version design doesn't ship whole.
export function thin<T>(versions: T[], max: number): T[] {
  if (versions.length <= max) return versions;
  if (max < 1) return [];
  if (max === 1) return versions.slice(-1); // just the last
  const step = (versions.length - 1) / (max - 1);
  return Array.from(
    { length: max },
    (_, i) => versions[Math.round(i * step)],
  ).filter((v): v is T => v !== undefined);
}
