import {
  battleDeps,
  battleResults,
  problems,
  sessionReader,
  soloLocks,
} from "../../../../server/container";
import {
  battleModeOf,
  randomProblem,
  startBattle,
} from "../../../../server/battles";
import { forbidden } from "../../../../server/capability";
import { sameOrigin } from "../../../../server/same-origin";
import { claimSolo } from "../../../../server/solo";

export const dynamic = "force-dynamic";

// P5-W32 (§6.6; Q-P5-19): nobody matched in 60 s, so the player battles alone, unrated,
// against the reference pace the page shows. One at a time (claimSolo): a refusal names
// the running solo, so the lobby can lead back to it.
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const battleMode = battleModeOf(request);
  if (battleMode === null) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused =
    (await forbidden(actor, "play.battle")) ??
    (await forbidden(actor, "play.live"));
  if (refused !== null) return refused;
  const locks = soloLocks();
  const results = battleResults();
  const claim = await claimSolo(
    {
      locks,
      // Gone (not this player's) counts as ended: nothing left to go back to.
      ended: async (matchId) =>
        (await results.of(matchId, actor.userId))?.finishedAt !== null,
    },
    actor.userId,
    "battle",
  );
  if (!claim.allowed)
    return Response.json({ matchId: claim.matchId }, { status: 429 });
  const matchId = await startBattle(
    battleDeps(),
    0,
    await randomProblem(problems(), battleMode),
    [actor.userId],
    { unrated: true, battleMode },
  );
  await locks.bind(actor.userId, "battle", matchId);
  return Response.json({ matchId }, { status: 201 });
}
