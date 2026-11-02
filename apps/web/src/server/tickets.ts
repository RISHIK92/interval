import { createHmac } from "node:crypto";

// P3-W15-S02 (ADR-0033, LOAD-2): a match ticket names the match, the player and the game
// server that owns the match. The game server checks it (services/game/ticket.go) and
// never reads the auth database. Format, shared through
// services/game/testdata/tickets.json:
// v1.<base64url(JSON claims)>.<base64url(HMAC-SHA256 of the first two parts)>.
export type TicketClaims = {
  m: string; // match id
  u: string; // user id
  s: string; // the game server that owns the match
  e: number; // expiry, Unix seconds
  n: string; // nonce: the game server takes each ticket once
};

// Long enough to open the socket, too short to pass around (ADR-0033).
export const TICKET_SECONDS = 60;

export function signTicket(claims: TicketClaims, secret: string): string {
  // Fixed key order, so both sides see the same bytes.
  const { m, u, s, e, n } = claims;
  const body = `v1.${Buffer.from(JSON.stringify({ m, u, s, e, n })).toString("base64url")}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
