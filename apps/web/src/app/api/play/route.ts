import type { PlayResponse } from "@interval/api-client";
import {
  entitlements,
  quizzes,
  sessionReader,
} from "../../../server/container";
import { fromSiteOrApp } from "../../../server/same-origin";
import { GAME_STARTS } from "../../../server/quiz-flow";

export const dynamic = "force-dynamic";

// P4-W21-S01 (§6.3, OPS-3): Play in the app: the games the plan includes and today's
// challenge with the streak, as the web's Play page reads them.
export async function GET(request: Request): Promise<Response> {
  if (!fromSiteOrApp(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  // ADR-0029: guests play too.
  if (actor === null) return new Response(null, { status: 401 });
  const can = (game: keyof typeof GAME_STARTS) =>
    entitlements().can(actor.userId, GAME_STARTS[game].capability);
  const [sprint, estimation, daily, status] = await Promise.all([
    can("sprint"),
    can("estimation"),
    can("daily"),
    quizzes().dailyStatus(actor.userId),
  ]);
  const body: PlayResponse = {
    games: { sprint, estimation, daily },
    daily: status,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
