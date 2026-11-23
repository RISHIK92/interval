import type { SoloGame, SoloLocks } from "./ports";

// P5-W32 (Q-P5-19): how long a solo of each kind holds its game server actor.
const MINUTES: Record<SoloGame, number> = { battle: 45, hld: 30 };

// One solo game of each kind at a time per player. A claim held by a match that has
// ended (finished early, say) is released and claimed afresh; otherwise the refusal
// names the running match, when it has one, so the player can go back to it.
export async function claimSolo(
  deps: { locks: SoloLocks; ended: (matchId: string) => Promise<boolean> },
  userId: string,
  game: SoloGame,
): Promise<{ allowed: true } | { allowed: false; matchId: string | null }> {
  const seconds = MINUTES[game] * 60;
  const first = await deps.locks.claim(userId, game, seconds);
  if (first === true) return { allowed: true };
  if (first.matchId === null || !(await deps.ended(first.matchId)))
    return { allowed: false, matchId: first.matchId };
  await deps.locks.release(userId, game, first.matchId);
  // Once: a claim taken in between (another tab) wins, and is reported as running.
  const again = await deps.locks.claim(userId, game, seconds);
  return again === true
    ? { allowed: true }
    : { allowed: false, matchId: again.matchId };
}
