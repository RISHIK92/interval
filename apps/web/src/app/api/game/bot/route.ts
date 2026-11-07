import { cookies } from "next/headers";
import { z } from "zod";
import { type Actor, GAME_MODES } from "../../../../server/ports";
import {
  events,
  replayMatch,
  matchmaking,
  sessionReader,
} from "../../../../server/container";
import { sameOrigin } from "../../../../server/same-origin";
import { visitId } from "../../../../server/visits";

export const dynamic = "force-dynamic";

const Mode = z.enum(GAME_MODES);

// P3-W17-S01, S02 (BOT-1, BOT-2, C-01, Q-P3-26): "Play bot now", and the queue's
// switch after 10 s. The player leaves the queues and gets a ghost if one fits, else a
// synthetic bot, for accounts and guests (ADR-0029); the browser then asks for its
// ticket as for any match. 404: not even a bot could be made (a short bank).
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const mode = Mode.safeParse(new URL(request.url).searchParams.get("mode"));
  if (!mode.success) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  // P3-W18-S03 (owner, 2026-11-05): the time-to-match metric counts every live match,
  // so the queue's wait is read before leaving it. A poll pairs: a person found now
  // is the match.
  const before = await matchmaking(mode.data).poll(actor.userId);
  if (before.status === "matched") {
    if (before.first) await found(actor, before.waitedMs, "person");
    return Response.json(
      { matchId: before.matchId },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  await Promise.all(
    Mode.options.map((m) => matchmaking(m).leave(actor.userId)),
  );
  // Paired with a person just before leaving (a matched seat stays matched): that
  // match is the one to play, not a ghost as well.
  for (const m of Mode.options) {
    const state = await matchmaking(m).poll(actor.userId);
    if (state.status === "matched") {
      if (state.first) await found(actor, state.waitedMs, "person");
      return Response.json(
        { matchId: state.matchId },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const match = await replayMatch(actor.userId, mode.data);
  if (match === null) return new Response(null, { status: 404 });
  // Out of the queue already (stale): its wait is unknown, so it isn't counted.
  if (before.status === "waiting")
    await found(
      actor,
      before.waitedMs,
      match.ghost?.player === "bot" ? "bot" : "ghost",
    );
  return Response.json(
    { matchId: match.id },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function found(
  actor: Actor,
  waitedMs: number,
  opponent: "person" | "ghost" | "bot",
): Promise<void> {
  events().emit(
    "match_found",
    { wait_ms: waitedMs, opponent },
    { ...actor, sessionId: visitId(await cookies()) },
  );
}
