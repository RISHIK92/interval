import {
  battleDeps,
  problems,
  sessionReader,
  soloAllowed,
} from "../../../../server/container";
import { randomProblem, startBattle } from "../../../../server/battles";
import { forbidden } from "../../../../server/capability";
import { sameOrigin } from "../../../../server/same-origin";

export const dynamic = "force-dynamic";

// P5-W32 (§6.6; Q-P5-19): nobody matched in 60 s, so the player battles alone, unrated,
// against the reference pace the page shows. One at a time (soloAllowed).
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused =
    (await forbidden(actor, "play.battle")) ??
    (await forbidden(actor, "play.live"));
  if (refused !== null) return refused;
  if (!(await soloAllowed(actor.userId)))
    return new Response(null, { status: 429 });
  const matchId = await startBattle(
    battleDeps(),
    0,
    await randomProblem(problems()),
    [actor.userId],
    { unrated: true },
  );
  return Response.json({ matchId }, { status: 201 });
}
