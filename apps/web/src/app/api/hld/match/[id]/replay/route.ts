import { z } from "zod";
import {
  hldMatches,
  hldTournaments,
  sessionReader,
} from "../../../../../../server/container";
import { forbidden } from "../../../../../../server/capability";
import { accessTo } from "../../../../../../server/hld-watch";

export const dynamic = "force-dynamic";

const MAX_FRAMES = 200; // per player: enough to scrub through, small enough to ship

// P6-W44 (Q-P6-03, Q-P6-08): a finished match's replay: each player's autosaves in order
// (thinned to MAX_FRAMES, the last always kept), for its players, and for anyone once a
// tournament round is over.
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
  if ((await accessTo(deps, id.data, actor.userId)) !== "replay")
    return new Response(null, { status: 404 });
  const [found, versions] = await Promise.all([
    deps.matches.get(id.data),
    deps.matches.versions(id.data, MAX_FRAMES),
  ]);
  if (found === null) return new Response(null, { status: 404 });
  return Response.json(
    {
      seats: found.seats.map((s) => ({
        player: s.player,
        total: s.total,
        frames: versions
          .filter((v) => v.userId === s.userId)
          .map((v) => ({ at: v.savedAt.toISOString(), design: v.design })),
      })),
    },
    // A finished match's replay never changes.
    { headers: { "cache-control": "private, max-age=300" } },
  );
}
