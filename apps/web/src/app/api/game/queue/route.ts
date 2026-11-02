import { cookies } from "next/headers";
import {
  events,
  matchmaking,
  playerRatings,
  sessionReader,
} from "../../../../server/container";
import type { Actor } from "../../../../server/ports";
import { sameOrigin } from "../../../../server/same-origin";
import { visitId } from "../../../../server/visits";

export const dynamic = "force-dynamic";

// P3-W16-S02 (MATCH-3; owner, 2026-11-03): the live 1v1 queue, for accounts and guests
// (ADR-0029). The browser joins (POST), polls about once a second until matched (PUT:
// a poll pairs and makes matches, so never a GET; and a browser sends Origin on it),
// then asks for a ticket (/api/game/ticket); it leaves (DELETE) when it stops waiting.
async function player(request: Request): Promise<Actor | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  return actor ?? new Response(null, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  await matchmaking().join(
    actor.userId,
    await playerRatings().of(actor.userId),
  );
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const state = await matchmaking().poll(actor.userId);
  if (state.status === "matched" && state.first)
    // The Phase 3 time-to-match metric; once per player.
    events().emit(
      "match_found",
      { wait_ms: state.waitedMs },
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
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  await matchmaking().leave(actor.userId);
  return new Response(null, { status: 204 });
}
