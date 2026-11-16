import { z } from "zod";
import {
  hldMatches,
  hldTournaments,
  sessionReader,
} from "../../../../../../server/container";
import { forbidden } from "../../../../../../server/capability";
import { accessTo } from "../../../../../../server/hld-watch";

export const dynamic = "force-dynamic";

// P6-W44 (§6.4, Q-P6-08): a tournament match as it's played, for a spectator: each
// side's latest autosave, the clock, and whether it's over. The page asks every few
// seconds.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const refused = await forbidden(actor, "play.hld");
  if (refused !== null) return refused;
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 400 });
  const deps = { matches: hldMatches(), tournaments: hldTournaments() };
  const access = await accessTo(deps, id.data, actor.userId);
  if (access === null) return new Response(null, { status: 404 });
  const found = await deps.matches.get(id.data);
  if (found === null) return new Response(null, { status: 404 });
  const seats = await Promise.all(
    found.seats.map(async (s) => ({
      player: s.player,
      submitted: s.submittedAt !== null,
      total: s.total,
      design:
        (await deps.matches.latestVersion(id.data, s.userId))?.design ?? null,
    })),
  );
  return Response.json(
    {
      over: found.match.closedAt !== null,
      deadline: found.match.deadlineAt.toISOString(),
      seats,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
