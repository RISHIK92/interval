import { cookies } from "next/headers";
import { windowTimeZone } from "../../../../env";
import {
  battleDeps,
  battleWindows,
  events,
  sessionReader,
} from "../../../../server/container";
import {
  remindAt,
  windowStatus,
  windowsFrom,
} from "../../../../server/battle-windows";
import { groupWindow } from "../../../../server/battles";
import { forbidden } from "../../../../server/capability";
import type { Actor } from "../../../../server/ports";
import { sameOrigin } from "../../../../server/same-origin";
import { visitId } from "../../../../server/visits";

export const dynamic = "force-dynamic";

// P5-W32 (§6.6, MATCH-7; Q-P5-12, Q-P5-19): ranked battle windows. GET says the current
// or next window and the player's place in it; POST registers for it while it's open;
// DELETE takes the registration back; PUT, polled from the window's start, groups its
// registrants if nobody has yet and answers with the player's battle. The site only:
// battles are desktop (§6.5).
async function player(request: Request): Promise<Actor | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  return (
    (await forbidden(actor, "play.battle")) ??
    (await forbidden(actor, "play.live")) ??
    actor
  );
}

function current(now: Date): Date {
  const [next] = windowsFrom(now, windowTimeZone());
  if (next === undefined)
    throw new Error("no battle window in the coming week");
  return next;
}

export async function GET(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const now = new Date();
  const at = current(now);
  const mine = await battleWindows().registration(at, actor.userId);
  return Response.json(
    {
      windowAt: at.toISOString(),
      status: windowStatus(at, now),
      registered: mine !== null,
      matchId: mine?.matchId ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const at = current(new Date());
  if (windowStatus(at, new Date()) !== "open")
    return new Response(null, { status: 409 });
  await battleWindows().register(at, actor.userId, remindAt(at));
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  // Only while registration is open: from 5 minutes before, the window is being
  // grouped, and a player taken out mid-grouping would lose their battle.
  const at = current(new Date());
  if (windowStatus(at, new Date()) !== "open")
    return new Response(null, { status: 409 });
  await battleWindows().unregister(at, actor.userId);
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const now = new Date();
  const at = current(now);
  const windows = battleWindows();
  let mine = await windows.registration(at, actor.userId);
  if (mine === null || windowStatus(at, now) !== "live")
    return Response.json(
      { matchId: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (mine.matchId === null) {
    const grouped = await groupWindow(
      { ...battleDeps(), windows },
      at,
      () => new Date(),
    );
    // Once a window: a retaken claim's leftovers would skew the metric.
    if (grouped?.first === true)
      events().emit(
        "battle_window_grouped",
        { registered: grouped.grouped, matched: grouped.matched },
        { ...actor, sessionId: visitId(await cookies()) },
      );
    mine = await windows.registration(at, actor.userId);
  }
  return Response.json(
    { matchId: mine?.matchId ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
