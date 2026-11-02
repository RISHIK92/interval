import { log } from "./log";
import type { GameMode, LiveMatch, MatchHandoff, Matches } from "./ports";

// P3-W15-S03 (ADR-0033, Q-P3-22): a live match, made with its questions and handed to
// the game server that will own it. Phase 3 runs one game server, 0; W16 matchmaking
// calls this.
export async function startLiveMatch(
  matches: Matches,
  handoff: MatchHandoff,
  players: string[],
  mode: GameMode,
): Promise<LiveMatch> {
  // Q-P3-22: live matches are 1v1.
  if (players.length !== 2 || players[0] === players[1])
    throw new Error("a live match needs two different players");
  const match = await matches.create(0, players, mode);
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

// P3-W17-S01 (BOT-1, Q-P3-25): a match against a ghost, handed to its server like any;
// null when no recorded run fits the player.
export async function startGhostMatch(
  matches: Matches,
  handoff: MatchHandoff,
  userId: string,
  mode: GameMode,
): Promise<LiveMatch | null> {
  const match = await matches.createGhost(0, userId, mode);
  if (match === null) return null;
  try {
    await handoff.put(match);
  } catch (error) {
    log.error("game: match not handed over", { matchId: match.id, error });
    throw error;
  }
  return match;
}
