"use server";

import { Design, fitsProblem } from "@interval/hld";
import { headers } from "next/headers";
import { z } from "zod";
import {
  entitlements,
  hldDeps,
  hldMatches,
  sessionReader,
} from "../../../../server/container";
import { problemOf, submitDesign } from "../../../../server/hld-matches";

// P6-W42 (Q-P6-03, Q-P6-06, ADR-0043): a match's autosave (every version kept: the
// replay) and its one submission. Everything is checked here: the player, the
// capability, the match still open, the design against the schema and the problem.
const MAX_BYTES = 64 * 1024;
// A save every 2 s for 30 minutes is 900; past this, it's not a person drawing.
const MAX_VERSIONS = 2_000;
const Version = z
  .int()
  .min(0)
  .max(MAX_VERSIONS - 1);

export type MatchSaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "signed-out" | "forbidden" | "invalid" | "stale" | "closed";
    };

async function player(): Promise<
  { userId: string } | "signed-out" | "forbidden"
> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) return "signed-out";
  return (await entitlements().can(actor.userId, "play.hld"))
    ? { userId: actor.userId }
    : "forbidden";
}

export async function saveMatchDesign(
  matchId: unknown,
  design: unknown,
  base: unknown,
): Promise<MatchSaveResult> {
  const seat = await player();
  if (typeof seat === "string") return { ok: false, reason: seat };
  const { userId } = seat;
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
  matchId: unknown,
  design: unknown,
): Promise<
  "submitted" | "already" | "closed" | "invalid" | "signed-out" | "forbidden"
> {
  const seat = await player();
  if (typeof seat === "string") return seat;
  const { userId } = seat;
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
