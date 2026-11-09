import { events, notes } from "./container";
import type { EventContext } from "./events";
import { log } from "./log";
import type { NoteTarget } from "./ports";

// Notes (§5I, Q-P2-01, P2-W7-S03): the note on a section or article, written from the
// web reader or the app's (P4-W20-S02). An empty body deletes it. Events carry ids only,
// never the text (DB-5 events are analytics, not user content).
export function emitNote(
  name: "note_saved" | "note_deleted",
  on: NoteTarget,
  context: EventContext,
): void {
  events().emit(name, { item_id: on.itemId, moment_id: on.momentId }, context);
}

export async function writeNote(
  context: EventContext,
  on: NoteTarget,
  body: string,
): Promise<void> {
  if (body !== "") {
    if (await notes().save(context.userId, on.itemId, on.momentId, body)) {
      emitNote("note_saved", on, context);
    } else {
      // The section was re-segmented away since the page was shown, or the ids are
      // stale: the text is lost, so it must at least be seen.
      log.warn("notes: nothing to attach the note to", {
        user_id: context.userId,
        item_id: on.itemId,
        moment_id: on.momentId,
      });
    }
  } else if (await notes().remove(context.userId, on.itemId, on.momentId)) {
    emitNote("note_deleted", on, context);
  }
}
