import { cookies } from "next/headers";
import { events, leaderboards, quizzes } from "../../../server/container";
import { log } from "../../../server/log";
import type { Actor } from "../../../server/ports";
import { visitId } from "../../../server/visits";

// P3-W15-S05 (PER-2, ARCH-2): a player's finished live matches, recorded by the worker,
// become mastery evidence and review cards on their next visit to the feed or Play. A
// failure leaves the page as it is (LOAD-5); the next visit tries again.
export async function applyMatchEvidence(actor: Actor): Promise<void> {
  try {
    const applied = await quizzes().applyMatchEvidence(actor.userId);
    if (applied.length === 0) return;
    const context = { ...actor, sessionId: visitId(await cookies()) };
    for (const { missed, ...match } of applied) {
      events().emit("match_finished", match, context);
      // P3-W18-S03 (owner, 2026-11-05): each miss it sends back to reading.
      for (const m of missed)
        events().emit(
          "concept_missed",
          { game: "live", item_id: m.itemId, moment_id: m.momentId },
          context,
        );
    }
    // P3-W16-S06: the worker rated these with their results; the player's season
    // boards show the new rating now, not when their markers lapse. Never throws.
    await leaderboards().invalidate(actor.userId);
  } catch (error) {
    log.error("game: match evidence not applied", {
      userId: actor.userId,
      error,
    });
  }
}
