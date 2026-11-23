import {
  casualBattles,
  playerRatings,
  sessionReader,
} from "../../../../server/container";
import { forbidden } from "../../../../server/capability";
import { battleModeOf } from "../../../../server/battles";
import type { Actor, BattleMode } from "../../../../server/ports";
import { sameOrigin } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P5-W32 (§6.6, MATCH-7; Q-P5-19): the casual battle queue, always open: unrated 1v1s
// on a random problem, banded by 1v1 battle rating. As the quick-game queue: POST joins,
// PUT polls (and pairs), DELETE leaves. After 60 s unmatched the page plays solo
// (/api/battle/solo).
async function player(
  request: Request,
): Promise<{ actor: Actor; battleMode: BattleMode } | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const battleMode = battleModeOf(request);
  if (battleMode === null) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  return (
    (await forbidden(actor, "play.battle")) ??
    (await forbidden(actor, "play.live")) ?? { actor, battleMode }
  );
}

export async function POST(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const { actor, battleMode } = seat;
  await casualBattles(battleMode).join(
    actor.userId,
    await playerRatings().battleOf(actor.userId, battleMode),
  );
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request): Promise<Response> {
  const seat = await player(request);
  if (seat instanceof Response) return seat;
  const state = await casualBattles(seat.battleMode).poll(seat.actor.userId);
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
  await casualBattles(seat.battleMode).leave(seat.actor.userId);
  return new Response(null, { status: 204 });
}
