"use server";

import { CARD_CONTROLS } from "@interval/api-client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import { applyControl } from "../../server/card-controls";
import { events, feedback, sessionReader } from "../../server/container";
import { type Actor, BIGINT_ID, REASON_KINDS } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

// ADR-0026/0027: "a reason is wrong" rides the card's one form as control
// "wrong_reason:<kind>", like the other menu buttons (no second form, no script).
const WRONG_REASON = "wrong_reason:";
const Reason = z.enum(REASON_KINDS);

// The card controls (§5C, Q-P1-15, ADR-0006 C-20, P1-W4-S07).
const Control = z.object({
  control: z.enum(CARD_CONTROLS),
  itemId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
});

export async function feedbackAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) redirect("/sign-up");
  const raw = Object.fromEntries(form);
  if (
    typeof raw["control"] === "string" &&
    raw["control"].startsWith(WRONG_REASON)
  ) {
    await reportReason(actor, raw["control"].slice(WRONG_REASON.length), raw);
    return;
  }
  const parsed = Control.safeParse(raw);
  if (!parsed.success) redirect("/");
  const { control, itemId, chip } = parsed.data;
  await applyControl(actor, itemId, control, {
    ...actor,
    sessionId: visitId(await cookies()),
  });
  // `back`: the in-app reader's Save stays in the reader (ADR-0018).
  redirect(
    sameSitePath(
      textField(form, "back"),
      control === "not_interested"
        ? `/?chip=${chip}&undo=${itemId}`
        : `/?chip=${chip}`,
    ),
  );
}

// ADR-0027: the card's stated reason is wrong (a tag, a mapping): kept for
// the admin's review queue; the ranking doesn't change from it.
async function reportReason(
  actor: Actor,
  kind: string,
  raw: Record<string, FormDataEntryValue>,
): Promise<void> {
  const parsed = z
    .object({
      reason: Reason,
      itemId: z.string().regex(BIGINT_ID),
      chip: z.enum(CHIPS),
    })
    .safeParse({ ...raw, reason: kind });
  if (!parsed.success) redirect("/");
  const { reason, itemId, chip } = parsed.data;
  if (await feedback().reportReason(actor.userId, itemId, reason)) {
    events().emit(
      "reason_reported",
      { kind: reason },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  }
  redirect(`/?chip=${chip}`);
}
