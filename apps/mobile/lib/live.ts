import type { LiveDeps, LiveHandlers, LiveSocket } from "@interval/game-client";
import { api } from "./api";
import { SITE } from "./auth";

export type LiveMode = "sprint" | "fastest_finger";

// P4-W21-S02 (ADR-0033, Q-P4-05): the app's transport for the shared protocol client:
// the queue, "Play bot now" and the ticket through the site's API, and the socket on
// the site itself, where Caddy or CloudFront routes /game/* to the game server. The
// ticket is the socket's only authorisation (services/game/server.go).
export async function openMatch(
  matchId: string,
  on: LiveHandlers,
): Promise<LiveSocket> {
  const response = await api("/api/game/ticket", {
    method: "POST",
    body: { matchId },
  });
  if (!response.ok) throw new Error(`no ticket: ${String(response.status)}`);
  const body: unknown = await response.json();
  const url =
    typeof body === "object" && body !== null && "url" in body
      ? body.url
      : undefined;
  if (typeof url !== "string") throw new Error("no socket in the ticket");
  // As the web's join.ts: the socket only ever goes to this site, and only to the game
  // server's path there (checked once resolved: "/game/../api" isn't).
  const site = new URL(SITE);
  const target = new URL(url, site);
  if (target.origin !== site.origin || !target.pathname.startsWith("/game/"))
    throw new Error("the ticket's socket is not this site's game server");
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(target.href);
  // Handlers go on while the socket is still connecting: no frame is missed.
  ws.onmessage = (event) => {
    on.message(event.data);
  };
  ws.onclose = (event) => {
    on.close(event.reason);
  };
  return ws;
}

export function transport(
  mode: LiveMode,
): Pick<LiveDeps<unknown>, "queue" | "open" | "fallback"> {
  return {
    queue: (method) => api(`/api/game/queue?mode=${mode}`, { method }),
    open: openMatch,
    fallback: async () => {
      const response = await api(`/api/game/bot?mode=${mode}`, {
        method: "POST",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`bot: ${String(response.status)}`);
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("matchId" in body) ||
        typeof body.matchId !== "string"
      )
        throw new Error("bot: no match id");
      return body.matchId;
    },
  };
}
