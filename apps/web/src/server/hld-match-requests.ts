import { Design, fitsProblem } from "@interval/hld";
import { z } from "zod";
import { hldDeps, hldMatches } from "./container";
import {
  opponentProgress,
  type OpponentProgress,
  problemOf,
  submitDesign,
} from "./hld-matches";

// P6-W42, W44 (Q-P6-03, Q-P6-06, ADR-0043): a match's autosave (every version kept: the
// replay) and its one submission, for the player the route has signed in. Everything
// else is checked here: the match still open, the design against the schema and the
// problem, its size. Routes rather than server actions, so a load test can drive them.
const MAX_BYTES = 64 * 1024;
// A save every 2 s for 30 minutes is 900; past this, it's not a person drawing.
const MAX_VERSIONS = 2_000;
const Version = z
  .int()
  .min(0)
  .max(MAX_VERSIONS - 1);

type MatchSaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "invalid" | "stale" | "closed";
    };

export async function saveMatchDesign(
  userId: string,
  matchId: string,
  design: unknown,
  base: unknown,
): Promise<MatchSaveResult> {
  const id = z.uuid().safeParse(matchId);
  const version = Version.safeParse(base);
  const parsed = Design.safeParse(design);
  if (
    !id.success ||
    !version.success ||
    !parsed.success ||
    JSON.stringify(parsed.data).length > MAX_BYTES
  )
    return { ok: false, reason: "invalid" };
  const found = await hldMatches().get(id.data);
  const mine = found?.seats.find((s) => s.userId === userId);
  if (
    found === null ||
    mine === undefined ||
    fitsProblem(parsed.data, problemOf(found.match)).length > 0
  )
    return { ok: false, reason: "invalid" };
  if (
    found.match.closedAt !== null ||
    found.match.deadlineAt <= new Date() ||
    mine.submittedAt !== null
  )
    return { ok: false, reason: "closed" };
  const saved = await hldMatches().saveVersion(
    id.data,
    userId,
    parsed.data,
    version.data,
  );
  // Refused: a newer save from another tab (or the match closing as it saved).
  return saved === null
    ? { ok: false, reason: "stale" }
    : { ok: true, version: saved };
}

export async function submitMatchDesign(
  userId: string,
  matchId: string,
  design: unknown,
): Promise<"submitted" | "already" | "closed" | "invalid"> {
  const id = z.uuid().safeParse(matchId);
  const parsed = Design.safeParse(design);
  if (
    !id.success ||
    !parsed.success ||
    JSON.stringify(parsed.data).length > MAX_BYTES
  )
    return "invalid";
  const done = await submitDesign(hldDeps(), id.data, userId, parsed.data);
  return done === "not_player" ? "invalid" : done;
}

// Q-WD-14, ADR-0060: whether each opponent has submitted, polled by each player's
// match page.
export async function matchProgress(
  userId: string,
  matchId: string,
): Promise<OpponentProgress | "not_player" | "closed"> {
  const id = z.uuid().safeParse(matchId);
  if (!id.success) return "not_player";
  return opponentProgress(
    { matches: hldMatches(), now: () => new Date() },
    id.data,
    userId,
  );
}
