import { log } from "./log";
import type { LiveMatch, MatchHandoff, Matches } from "./ports";

// P3-W15-S03 (ADR-0033, Q-P3-22): a live match, made with its questions and handed to
// the game server that will own it. Phase 3 runs one game server, 0; W16 matchmaking
// calls this.
export async function startLiveMatch(
  matches: Matches,
  handoff: MatchHandoff,
  players: string[],
): Promise<LiveMatch> {
  // Q-P3-22: live matches are 1v1.
  if (players.length !== 2 || players[0] === players[1])
    throw new Error("a live match needs two different players");
  const match = await matches.create(0, players);
  if (match === null) throw new Error("not enough live questions for a match");
  try {
    await handoff.put(match);
  } catch (error) {
    // Its server can't play it without the set: no match, and said so.
    log.error("game: match not handed over", { matchId: match.id, error });
    throw error;
  }
  return match;
}
