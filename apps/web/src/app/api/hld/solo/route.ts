import {
  hldDeps,
  sessionReader,
  soloAllowed,
} from "../../../../server/container";
import { battleModeOf } from "../../../../server/battles";
import { forbidden } from "../../../../server/capability";
import { startHldMatch } from "../../../../server/hld-matches";
import { sameOrigin } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P6-W42 (MATCH-7; Q-P6-06): nobody matched in 60 s, so the player designs alone,
// unrated, scored as any match. One at a time (soloAllowed).
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const battleMode = battleModeOf(request);
  if (battleMode === null) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  if (!(await soloAllowed(actor.userId, "hld")))
    return new Response(null, { status: 429 });
  const matchId = await startHldMatch(hldDeps(), [actor.userId], battleMode, {
    unrated: true,
    windowAt: null,
  });
  return Response.json({ matchId }, { status: 201 });
}
