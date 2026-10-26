"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import { events, progress, sessionReader } from "../../server/container";
import { BIGINT_ID } from "../../server/ports";
import { READING_COOKIE } from "../../server/reading";
import { visitId } from "../../server/visits";

// Finishing from the return prompt or Mark done (§5D, C-22, Q-P1-35, P1-W5-S02).
const Finish = z.object({
  control: z.enum(["finish", "dismiss"]),
  itemId: z.string().regex(BIGINT_ID),
  momentId: z.string().regex(BIGINT_ID).optional(),
  method: z.enum(["return_prompt", "mark_done"]),
  chip: z.enum(CHIPS),
});

export async function finishAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const parsed = Finish.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { control, itemId, momentId, method, chip } = parsed.data;
  const jar = await cookies();
  // Finished or dismissed, the Now reading panel has done its job.
  jar.delete(READING_COOKIE);
  if (control === "dismiss") redirect(`/?chip=${chip}`);
  const context = { ...actor, sessionId: visitId(jar) };
  if (momentId === undefined) {
    if (await progress().finishArticle(actor.userId, itemId, method)) {
      events().emit("article_finished", { method }, context);
    }
  } else if (
    await progress().finishMoment(actor.userId, itemId, momentId, method)
  ) {
    events().emit("section_finished", { method }, context);
    // Q-P1-35: the finish that completes an article finishes it (P1-W5-S03).
    if (
      await progress().finishArticleIfComplete(actor.userId, itemId, method)
    ) {
      events().emit("article_finished", { method }, context);
    }
  }
  // The feed then offers the next section (Yes, owner 2026-10-26).
  redirect(`/?chip=${chip}&finished=${itemId}.${momentId ?? ""}`);
}

const Dismiss = z.object({
  itemId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
});

// Q-P1-40: a continue card goes when dismissed.
export async function continueAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const parsed = Dismiss.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  await progress().dismissContinue(actor.userId, parsed.data.itemId);
  redirect(`/?chip=${parsed.data.chip}`);
}
