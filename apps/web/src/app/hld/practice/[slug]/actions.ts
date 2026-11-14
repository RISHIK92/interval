"use server";

import { Design, fitsProblem, PRACTICE_PROBLEMS } from "@interval/hld";
import { headers } from "next/headers";
import { z } from "zod";
import {
  entitlements,
  hldPracticeDesigns,
  sessionReader,
} from "../../../../server/container";

// P6-W39 (ADR-0042 PROPOSED, Q-P6-03): the canvas's autosave, about 2 s after the last
// change. Everything is checked here: the player, the problem, the design against the
// schema and against the problem (its components and request types), and its size. `base` is the version the canvas last saved or loaded; a stale
// one (another tab saved since) is refused, never overwritten.
const MAX_BYTES = 64 * 1024; // the largest design the schema allows is far smaller

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: "signed-out" | "forbidden" | "invalid" | "stale" };

export async function saveDesign(
  slug: unknown,
  design: unknown,
  base: unknown,
): Promise<SaveResult> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) return { ok: false, reason: "signed-out" };
  if (!(await entitlements().can(actor.userId, "play.hld")))
    return { ok: false, reason: "forbidden" };
  const problem = PRACTICE_PROBLEMS.find((p) => p.slug === slug);
  const version = z.int().min(0).max(2_147_483_647).safeParse(base); // the column's int4
  const parsed = Design.safeParse(design);
  if (
    problem === undefined ||
    !version.success ||
    !parsed.success ||
    fitsProblem(parsed.data, problem).length > 0 ||
    JSON.stringify(parsed.data).length > MAX_BYTES
  )
    return { ok: false, reason: "invalid" };
  const saved = await hldPracticeDesigns().save(
    actor.userId,
    problem.slug,
    parsed.data,
    version.data,
  );
  return saved === null
    ? { ok: false, reason: "stale" }
    : { ok: true, version: saved };
}
