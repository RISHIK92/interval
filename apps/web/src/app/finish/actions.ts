"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { progress, sessionReader } from "../../server/container";
import { finishReading } from "../../server/finish";
import { BIGINT_ID } from "../../server/ports";
import { parseReading, READING_COOKIE } from "../../server/reading";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

// Completing from the return prompt or Done (§5D, C-22, Q-P1-35, P1-W5-S02). ADR-0058:
// the article is the only unit; a section or chip an older page posts is ignored.
const Finish = z.object({
  control: z.enum(["finish", "dismiss"]),
  itemId: z.string().regex(BIGINT_ID),
  method: z.enum(["return_prompt", "mark_done"]),
});

export async function finishAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) redirect("/sign-up");
  const parsed = Finish.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { control, itemId, method } = parsed.data;
  // Answered from the Library, or a reader opened there: back to it (owner,
  // 2026-10-26). Only a path on this site.
  const back = sameSitePath(textField(form, "back"), "");
  const jar = await cookies();
  // Finished or dismissed, the Now reading panel has done its job; from the Library,
  // only when the panel was about this article (it is about what the feed opened).
  if (back === "" || parseReading(jar.get(READING_COOKIE)?.value) === itemId)
    jar.delete(READING_COOKIE);
  if (control === "dismiss") redirect(back || "/");
  await finishReading({ ...actor, sessionId: visitId(jar) }, itemId, method);
  // Home then says it is completed and offers its quiz again (ADR-0058).
  redirect(back || `/?finished=${itemId}`);
}

const Dismiss = z.object({ itemId: z.string().regex(BIGINT_ID) });

// Q-P1-40: a continue card goes when dismissed.
export async function continueAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) redirect("/sign-up");
  const parsed = Dismiss.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  await progress().dismissContinue(actor.userId, parsed.data.itemId);
  redirect("/");
}
