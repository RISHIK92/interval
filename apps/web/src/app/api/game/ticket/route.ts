import { randomUUID } from "node:crypto";
import { z } from "zod";
import { gameEnv } from "../../../../env";
import { matches, sessionReader } from "../../../../server/container";
import { sameOrigin } from "../../../../server/same-origin";
import { signTicket, TICKET_SECONDS } from "../../../../server/tickets";

export const dynamic = "force-dynamic";

const Join = z.object({ matchId: z.uuid() });

// P3-W15-S02 (ADR-0033, LOAD-2): a ticket to the game server that owns the match, for a
// player of it only (accounts and guests, ADR-0029). Same origin only, like every
// signed-in POST. The browser opens the returned path as a WebSocket.
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return new Response(null, { status: 401 });
  const parsed = Join.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  // Not configured (no GAME_TICKET_SECRET): live games aren't offered, as the GitHub
  // App isn't without its settings. A setting left out, not a failure to count.
  const game = gameEnv();
  if (game === null) return new Response(null, { status: 503 });
  const seat = await matches().serverFor(parsed.data.matchId, actor.userId);
  if (seat === null) return new Response(null, { status: 404 });
  const { serverId, playedAs } = seat;
  const ticket = signTicket(
    {
      m: parsed.data.matchId,
      // The id the match knows the player by (Q-P3-21: a guest who signed up keeps it).
      u: playedAs,
      s: String(serverId),
      e: Math.floor(Date.now() / 1000) + TICKET_SECONDS,
      n: randomUUID(),
    },
    game.GAME_TICKET_SECRET,
  );
  return Response.json(
    {
      url: `/game/${String(serverId)}/ws?ticket=${encodeURIComponent(ticket)}`,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
