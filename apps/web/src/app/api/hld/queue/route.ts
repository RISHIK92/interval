import {
  casualHld,
  hldMatches,
  sessionReader,
} from "../../../../server/container";
import { forbidden } from "../../../../server/capability";
import { battleModeOf } from "../../../../server/battles";
import type { Actor, BattleMode } from "../../../../server/ports";
import { sameOrigin } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P6-W42 (MATCH-7; Q-P6-06): the casual HLD queue, always open: unrated 1v1s on a pooled
// variant, banded by HLD 1v1 rating, apart from LLD's. POST joins, PUT polls (and
// pairs), DELETE leaves. After 60 s unmatched the page plays solo (/api/hld/solo).
async function player(
  request: Request,
): Promise<{ actor: Actor; battleMode: BattleMode } | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const battleMode = battleModeOf(request);
  if (battleMode === null) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  return (await forbidden(actor, "play.hld")) ?? { actor, battleMode };
}

export async function POST(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const { actor, battleMode } = seat;
  await casualHld(battleMode).join(
    actor.userId,
    await hldMatches().ratingOf(actor.userId, battleMode),
  );
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const state = await casualHld(seat.battleMode).poll(seat.actor.userId);
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
  await casualHld(seat.battleMode).leave(seat.actor.userId);
  return new Response(null, { status: 204 });
}
