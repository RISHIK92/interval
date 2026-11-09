"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { adminPronunciations } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// As the seed's limits (workers/jobs pronunciations.py).
const Term = z.object({
  term: z.string().trim().min(1).max(80),
  say: z.string().trim().min(1).max(200),
});

// P4-W22-S02 (TTS-2, Q-P4-10): add a term and how to say it. Server actions are reachable
// without the page, so this checks access again.
export async function addPronunciationAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const parsed = Term.safeParse({
    term: textField(form, "term"),
    say: textField(form, "say"),
  });
  if (!parsed.success) redirect("/admin/pronunciations?error=invalid");
  const added = await adminPronunciations().add(
    parsed.data.term,
    parsed.data.say,
    actor.userId,
  );
  redirect(
    added === "added"
      ? "/admin/pronunciations?saved=1"
      : "/admin/pronunciations?error=taken",
  );
}

// An admin-added term only; the seed's change in its YAML file.
export async function removePronunciationAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = textField(form, "id");
  if (!BIGINT_ID.test(id)) notFound();
  const removed = await adminPronunciations().remove(id);
  redirect(
    removed
      ? "/admin/pronunciations?saved=1"
      : "/admin/pronunciations?error=kept",
  );
}
