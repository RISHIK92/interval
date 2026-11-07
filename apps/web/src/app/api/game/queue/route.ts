import { cookies } from "next/headers";
import { z } from "zod";
import {
  events,
  matchmaking,
  playerRatings,
  sessionReader,
} from "../../../../server/container";
import {
  type Actor,
  GAME_MODES,
  type GameMode,
} from "../../../../server/ports";
import { sameOrigin } from "../../../../server/same-origin";
import { visitId } from "../../../../server/visits";

export const dynamic = "force-dynamic";

// P3-W16-S02 (MATCH-3; owner, 2026-11-03): the live 1v1 queue, for accounts and guests
// (ADR-0029). The browser joins (POST), polls about once a second until matched (PUT:
// a poll pairs and makes matches, so never a GET; and a browser sends Origin on it),
// then asks for a ticket (/api/game/ticket); it leaves (DELETE) when it stops waiting.
// P3-W16-S04 (Q-P3-23): ?mode= picks the mode's own queue.
const Mode = z.enum(GAME_MODES);

async function player(
  request: Request,
): Promise<{ actor: Actor; mode: GameMode } | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const mode = Mode.safeParse(new URL(request.url).searchParams.get("mode"));
  if (!mode.success) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  return { actor, mode: mode.data };
}

export async function POST(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const { actor, mode } = seat;
  // Q-P3-24: one queue at a time, so nobody is matched twice at once.
  await matchmaking(mode === "sprint" ? "fastest_finger" : "sprint").leave(
    actor.userId,
  );
  await matchmaking(mode).join(
    actor.userId,
    await playerRatings().of(actor.userId),
  );
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const { actor, mode } = seat;
  const state = await matchmaking(mode).poll(actor.userId);
  if (state.status === "matched" && state.first)
    // The Phase 3 time-to-match metric; once per player.
    events().emit(
      "match_found",
      { wait_ms: state.waitedMs, opponent: "person" },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  return Response.json(
    state.status === "matched"
      ? { status: "matched", matchId: state.matchId }
      : { status: state.status },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const { actor, mode } = seat;
  await matchmaking(mode).leave(actor.userId);
  return new Response(null, { status: 204 });
}
