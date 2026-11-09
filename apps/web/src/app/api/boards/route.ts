import type { BoardResponse, FeedSetup } from "@interval/api-client";
import {
  GAME_LABELS,
  PERIOD_LABELS,
  readBoard,
  SCOPE_LABELS,
} from "../../../server/board-view";
import { GAMES, PERIODS } from "../../../server/boards";
import { sessionReader, usernames } from "../../../server/container";
import { fromSiteOrApp } from "../../../server/same-origin";

export const dynamic = "force-dynamic";

// P4-W21-S03 (§6.7): a board for the app, read as the web's boards page reads it
// (server/board-view.ts). Guests see the global and universities boards (ADR-0029); an
// account picks its username first, as on the web.
export async function GET(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  if (!actor.isGuest && (await usernames().get(actor.userId)) === null)
    return Response.json({ setup: "username" } satisfies FeedSetup, {
      status: 409,
    });
  const query = new URL(request.url).searchParams;
  const view = await readBoard(
    actor,
    {
      game: query.get("game") ?? undefined,
      scope: query.get("scope") ?? undefined,
      period: query.get("period") ?? undefined,
    },
    new Date(),
  );
  const body: BoardResponse = {
    ...view,
    scopes: view.scopes.map((key) => ({ key, label: SCOPE_LABELS[key] })),
    games: GAMES.map((key) => ({ key, label: GAME_LABELS[key] })),
    periods: PERIODS.map((key) => ({
      key,
      label: PERIOD_LABELS[view.game][key],
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
