import { windowTimeZone } from "../../../../env";
import {
  hldDeps,
  hldWindows,
  sessionReader,
} from "../../../../server/container";
import { windowStatus, windowsFrom } from "../../../../server/battle-windows";
import { leagueOf } from "../../../../server/battles";
import { forbidden } from "../../../../server/capability";
import { groupHldWindow } from "../../../../server/hld-matches";
import type { Actor } from "../../../../server/ports";
import { sameOrigin } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P6-W42 (MATCH-7, Q-P6-06): HLD's ranked windows, at LLD's times, registered apart. GET
// says the current or next window and the player's place in it; POST registers while
// it's open; DELETE takes it back; PUT, polled from the window's start, groups its
// registrants if nobody has yet and answers with the player's match.
async function player(request: Request): Promise<Actor | Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  return (await forbidden(actor, "play.hld")) ?? actor;
}

function current(now: Date): Date {
  const [next] = windowsFrom(now, windowTimeZone());
  if (next === undefined) throw new Error("no window in the coming week");
  return next;
}

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const now = new Date();
  const at = current(now);
  const mine = await hldWindows().registration(at, actor.userId);
  return Response.json(
    {
      windowAt: at.toISOString(),
      status: windowStatus(at, now),
      registered: mine !== null,
      league: mine?.league ?? null,
      matchId: mine?.matchId ?? null,
    },
    noStore,
  );
}

export async function POST(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const at = current(new Date());
  if (windowStatus(at, new Date()) !== "open")
    return new Response(null, { status: 409 });
  const league = leagueOf(request);
  if (league === null) return new Response(null, { status: 400 });
  await hldWindows().register(at, actor.userId, league);
  return new Response(null, { status: 204 });
}

export async function DELETE(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  // Only while registration is open: a player taken out mid-grouping would lose their
  // match.
  const at = current(new Date());
  if (windowStatus(at, new Date()) !== "open")
    return new Response(null, { status: 409 });
  await hldWindows().unregister(at, actor.userId);
  return new Response(null, { status: 204 });
}

export async function PUT(request: Request): Promise<Response> {
  const actor = await player(request);
  if (actor instanceof Response) return actor;
  const now = new Date();
  const at = current(now);
  const windows = hldWindows();
  let mine = await windows.registration(at, actor.userId);
  if (mine === null || windowStatus(at, now) !== "live")
    return Response.json({ matchId: null }, noStore);
  if (mine.matchId === null) {
    await groupHldWindow({ ...hldDeps(), windows }, at, mine.league);
    mine = await windows.registration(at, actor.userId);
  }
  return Response.json({ matchId: mine?.matchId ?? null }, noStore);
}
