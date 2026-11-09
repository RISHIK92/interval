import { randomUUID } from "node:crypto";
import type { CardControl } from "@interval/api-client";
import { events, feedback, jobQueue } from "./container";
import type { EventContext } from "./events";
import type { Actor } from "./ports";
import { queueRecompute } from "./recompute";

// The card controls (§5C, Q-P1-15, ADR-0006 C-20, P1-W4-S07), for the PWA's card form
// and the app's /api/feed/control (P4-W20-S01) alike. True when something changed.
export async function applyControl(
  actor: Actor,
  itemId: string,
  control: CardControl,
  context: EventContext,
): Promise<boolean> {
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
  return changed;
}
