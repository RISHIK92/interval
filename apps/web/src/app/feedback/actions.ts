"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../server/chips";
import {
  events,
  feedback,
  jobQueue,
  sessionReader,
} from "../../server/container";
import { queueRecompute } from "../../server/recompute";
import { BIGINT_ID } from "../../server/ports";
import { visitId } from "../../server/visits";
import { sameSitePath, textField } from "../form";

// The card controls (§5C, Q-P1-15, ADR-0006 C-20, P1-W4-S07).
const Control = z.object({
  control: z.enum([
    "more_like_this",
    "less_like_this",
    "not_interested",
    "hide_source",
    "save",
    "unsave",
    "undo_not_interested",
  ]),
  itemId: z.string().regex(BIGINT_ID),
  chip: z.enum(CHIPS),
});

export async function feedbackAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const parsed = Control.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/");
  const { control, itemId, chip } = parsed.data;
  const context = { ...actor, sessionId: visitId(await cookies()) };
  const port = feedback();
  let changed: boolean;
  switch (control) {
    case "hide_source":
      changed = await port.hideSource(actor.userId, itemId);
      if (changed) events().emit("source_hidden", {}, context);
      break;
    case "save":
      changed = await port.save(actor.userId, itemId);
      if (changed) events().emit("item_saved", {}, context);
      break;
    case "unsave":
      // No event: none is in the accepted list (P1-W5-S04).
      changed = await port.unsave(actor.userId, itemId);
      break;
    case "undo_not_interested":
      changed = await port.undoNotInterested(actor.userId, itemId);
      if (changed) {
        events().emit("feedback_undone", { kind: "not_interested" }, context);
      }
      break;
    default:
      changed = await port.give(actor.userId, itemId, control);
      if (changed) events().emit("feedback_given", { kind: control }, context);
  }
  // Q-P1-17: the feed is recomputed after feedback. If the queue is down, Not
  // interested and Hide source still apply at read, and the hourly pass catches up
  // (LOAD-5).
  if (changed) {
    await queueRecompute(
      jobQueue(),
      actor.userId,
      `feedback-${actor.userId}-${randomUUID()}`,
      "feed: recompute after feedback not queued",
    );
  }
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
