import {
  hldDeps,
  hldMatches,
  sessionReader,
  soloLocks,
} from "../../../../server/container";
import { battleModeOf } from "../../../../server/battles";
import { forbidden } from "../../../../server/capability";
import { startHldMatch } from "../../../../server/hld-matches";
import { sameOrigin } from "../../../../server/same-origin";
import { claimSolo } from "../../../../server/solo";

export const dynamic = "force-dynamic";

// P6-W42 (MATCH-7; Q-P6-06): nobody matched in 60 s, so the player designs alone,
// unrated, scored as any match. One at a time (claimSolo): a refusal names the running
// solo, so the lobby can lead back to it.
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const battleMode = battleModeOf(request);
  if (battleMode === null) return new Response(null, { status: 400 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  const locks = soloLocks();
  const matches = hldMatches();
  const claim = await claimSolo(
    {
      locks,
      // Closed or scored ended it; gone counts as ended: nothing left to go back to.
      ended: async (matchId) => {
        const found = await matches.get(matchId);
        return (
          found === null ||
          found.match.closedAt !== null ||
          found.match.scoredAt !== null
        );
      },
    },
    actor.userId,
    "hld",
  );
  if (!claim.allowed)
    return Response.json({ matchId: claim.matchId }, { status: 429 });
  const matchId = await startHldMatch(hldDeps(), [actor.userId], battleMode, {
    unrated: true,
    windowAt: null,
  });
  await locks.bind(actor.userId, "hld", matchId);
  return Response.json({ matchId }, { status: 201 });
}
