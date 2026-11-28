"use server";

import { GENERATORS } from "@interval/lld";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { gameEnv } from "../../../../../env";
import { startPracticeSession } from "../../../../../server/battles";
import {
  entitlements,
  events,
  lldPractice,
  practiceDeps,
  problems,
  sessionReader,
} from "../../../../../server/container";
import { visitId } from "../../../../../server/visits";

// ADR-0048 (Q-WD-28): LLD practice's autosave, about 2 s after the last edit, and its
// session start. Everything is checked here: the player (play.battle), a practice
// problem, a language battles are judged in, the code's size (the game server's
// maxCodeBytes), and `base`, the version the page last saved or loaded; a stale one
// (another tab saved since) is refused, never overwritten.
const MAX_BYTES = 256 * 1024;
const Version = z.int().min(0).max(2_147_483_647); // the column's int4

export type SaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "signed-out" | "forbidden" | "invalid" | "too-large" | "stale";
    };

export async function saveCode(
  slug: unknown,
  language: unknown,
  code: unknown,
  base: unknown,
): Promise<SaveResult> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) return { ok: false, reason: "signed-out" };
  if (!(await entitlements().can(actor.userId, "play.battle")))
    return { ok: false, reason: "forbidden" };
  const version = Version.safeParse(base);
  if (
    typeof slug !== "string" ||
    typeof language !== "string" ||
    !Object.hasOwn(GENERATORS, language) ||
    typeof code !== "string" ||
    !version.success
  )
    return { ok: false, reason: "invalid" };
  if (new TextEncoder().encode(code).length > MAX_BYTES)
    return { ok: false, reason: "too-large" };
  const problem = await problems().get(slug);
  if (problem?.pool !== "practice") return { ok: false, reason: "invalid" };
  const saved = await lldPractice().saveCode(
    actor.userId,
    slug,
    language,
    code,
    version.data,
  );
  return saved === null
    ? { ok: false, reason: "stale" }
    : { ok: true, version: saved };
}

type StartResult =
  | { ok: true; matchId: string }
  | {
      ok: false;
      reason:
        "signed-out" | "forbidden" | "unavailable" | "invalid" | "limited";
    };

// A practice session on the game server: the player's open one on this problem, or a
// new one when there's none or the page says `ended` is over.
export async function startSession(
  slug: unknown,
  ended: unknown,
): Promise<StartResult> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) return { ok: false, reason: "signed-out" };
  const [battle, live] = await Promise.all([
    entitlements().can(actor.userId, "play.battle"),
    entitlements().can(actor.userId, "play.live"),
  ]);
  if (!battle || !live) return { ok: false, reason: "forbidden" };
  if (gameEnv() === null) return { ok: false, reason: "unavailable" };
  if (typeof slug !== "string" || (ended !== null && typeof ended !== "string"))
    return { ok: false, reason: "invalid" };
  const started = await startPracticeSession(
    practiceDeps(),
    actor.userId,
    slug,
    ended,
  );
  switch (started.status) {
    case "not-practice":
      return { ok: false, reason: "invalid" };
    case "limited":
      return { ok: false, reason: "limited" };
    case "started":
      events().emit(
        "lld_practice_started",
        { problem_slug: slug, difficulty: started.problem.difficulty },
        { ...actor, sessionId: visitId(await cookies()) },
      );
      return { ok: true, matchId: started.matchId };
    case "open":
      return { ok: true, matchId: started.matchId };
  }
}
