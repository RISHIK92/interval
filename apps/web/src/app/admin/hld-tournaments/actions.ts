"use server";

import { matchProblem } from "@interval/hld";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { hldTournaments, tournamentDeps } from "../../../server/container";
import { nextRound } from "../../../server/hld-tournaments";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P6-W43 (§6.4, HLDQ-3, Q-P6-07): the owner makes a tournament (its 8 rounds' problems
// picked from the pool, and retired) and starts each round. Server actions are reachable
// without the page, so each checks access again.
const ROUNDS = 8;

const Tournament = z.object({
  name: z.string().trim().min(3).max(80),
  battleMode: z.enum(["human", "ai"]),
  startsAt: z.coerce.date(),
  rounds: z
    .array(z.string().regex(/^[a-z-]+\/\d+$/))
    .length(ROUNDS)
    .refine((r) => new Set(r).size === r.length, "a problem picked twice"),
});

export async function createTournamentAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const parsed = Tournament.safeParse({
    name: textField(form, "name"),
    battleMode: textField(form, "battleMode"),
    // datetime-local is the admin's local time without a zone: read it as UTC, as the
    // form says.
    startsAt: `${textField(form, "startsAt")}:00Z`,
    rounds: Array.from({ length: ROUNDS }, (_, i) =>
      textField(form, `round${String(i + 1)}`),
    ),
  });
  if (!parsed.success) redirect("/admin/hld-tournaments?error=invalid");
  const { name, battleMode, startsAt, rounds } = parsed.data;
  const picked = rounds.map((r) => {
    const [family = "", seed = ""] = r.split("/");
    return { family, seed: Number(seed) };
  });
  // Only pooled variants of this battle mode: validated, so a round can't fail mid-cup.
  if (picked.some((p) => matchProblem(p.family, battleMode, p.seed) === null))
    redirect("/admin/hld-tournaments?error=invalid");
  const id = await hldTournaments().create(
    { name, battleMode, startsAt, rounds: picked },
    actor.userId,
  );
  redirect(`/admin/hld-tournaments?saved=${id}`);
}

export async function nextRoundAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().safeParse(textField(form, "id"));
  if (!id.success) notFound();
  const done = await nextRound(tournamentDeps(), id.data);
  redirect(`/admin/hld-tournaments?round=${done}`);
}
