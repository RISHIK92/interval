// P3-W15-S02 (ADR-0033): joins a live match from the browser. The web app's ticket names
// the game server that owns the match; the socket goes there, on this same site
// (Caddy or CloudFront routes /game/* to it).
export async function openMatch(matchId: string): Promise<WebSocket> {
  const response = await fetch("/api/game/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId }),
  });
  if (!response.ok) throw new Error(`no ticket: ${String(response.status)}`);
  const body: unknown = await response.json();
  const url =
    typeof body === "object" && body !== null && "url" in body
      ? body.url
      : undefined;
  if (typeof url !== "string") throw new Error("no socket in the ticket");
  const target = new URL(url, location.href);
  if (target.origin !== location.origin)
    throw new Error("the ticket's socket is not this site");
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(target.href);
}
