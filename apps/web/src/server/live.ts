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
  options?: { unrated: boolean }, // a friend challenge (P3-W17-S03)
): Promise<LiveMatch> {
  // Q-P3-22: live matches are 1v1.
  if (players.length !== 2 || players[0] === players[1])
    throw new Error("a live match needs two different players");
  const match = await matches.create(0, players, mode, options);
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

// P3-W17-S01, S02 (BOT-1, BOT-2, C-01): with no person to play, a ghost (a recorded
// run) if one fits, else a synthetic bot, handed to its server like any match; null
// only when even a bot can't be made (the bank is short).
export async function startReplayMatch(
  matches: Matches,
  handoff: MatchHandoff,
  userId: string,
  mode: GameMode,
): Promise<LiveMatch | null> {
  const match =
    (await matches.createGhost(0, userId, mode)) ??
    (await matches.createBot(0, userId, mode));
  if (match === null) return null;
  try {
    await handoff.put(match);
  } catch (error) {
    log.error("game: match not handed over", { matchId: match.id, error });
    throw error;
  }
  return match;
}
