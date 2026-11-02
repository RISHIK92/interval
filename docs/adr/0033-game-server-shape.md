# 0033. The game server's shape in both modes, and match tickets

- Status: ACCEPTED
- Date: 2026-11-02
- Supersedes: none
- Superseded by: none

## Context

Phase 3 Week 15 adds the first Go code and a new deployable: the game server for live matches.

- ARCH-1: "separate deployables added only when a phase needs them". Week 15 is that phase.
- ARCH-2: Go is for "game server, execution engine (Phase 3+)".
- LOAD-2: "Each match is owned by one server process, behind an Application Load Balancer with WebSockets, and saves a snapshot after every round."
- LOAD-3: "real-time work uses Redis".
- MATCH-5: server-side timing. MATCH-6: a 10-second reconnect grace period.
- ADR-0011: two deployment modes (full AWS and one VM) from the same code, every backing service from env. ADR-0013: build and verify locally; no deployment until all phases are built.

The problem: with more than one game server, a player's WebSocket must reach the process that owns their match, and the Go server must know who the player is without a second auth system.

Q-P3-01, answered by the owner on 2026-10-31: "a signed match ticket names the owning server; one game server behind Caddy in VM mode; Go never reads the auth database. Written up as an ADR before W15-S01." P3-W15-S01 needs this ADR ACCEPTED.

## Options

### A. One Go service, signed match tickets that name the owning server (the owner's answer)

- `services/game`: one Go module and one binary, configured from env only (ADR-0011).
- The web app (TypeScript) matches players and signs a ticket: match id, user id, owning server id and expiry, as HMAC-SHA256 with `GAME_TICKET_SECRET`, which both sides read from env.
- The browser opens `wss://<host>/game/<server-id>/ws?ticket=…`.
  - The server checks the signature, the expiry, and that the server id is its own.
  - It never reads the auth database or the session cookie.
- **VM mode:** one game server; Caddy proxies `/game/*` to it.
- **AWS mode:** game servers are numbered, as a small fixed set of Fargate services (`game-0`, …), each with its own target group. An ALB listener rule routes `/game/<id>/*` to that group, with WebSocket support and long idle timeouts.
  - Phase 3 runs one (`game-0`); adding one is a CDK change.
- Snapshots after each round (LOAD-2) and the reconnect grace period (MATCH-6) live in Valkey (LOAD-3). A restarted server can then resume a match it owned, from W15-S04.
- Pros:
  - follows LOAD-2's actor model exactly, so match state lives in one process's memory and timing is server-side (MATCH-5);
  - no shared session store between TypeScript and Go;
  - the same binary in both modes;
  - routing is explicit and testable.
- Cons:
  - a fixed set of numbered servers is static scaling: adding capacity means a deploy, not autoscaling;
  - the ticket secret must be rotated in two places.
- Cost to reverse: low to medium. The ticket format and the `/game/<id>` path are the contract; replacing the routing with service discovery later doesn't change the client.

### B. Stateless game servers, with match state in Valkey

Any server takes any socket and reads and writes the match in Valkey on every event.

- Pros: plain autoscaling behind the ALB, with no routing.
- Cons:
  - contradicts LOAD-2 (one owning process per match);
  - every answer is a Valkey round-trip, which works against MATCH-5's timing;
  - simultaneous answers race and need distributed locking.
- Cost to reverse: high, because the match engine would be written around external state.

### C. WebSockets inside the Next.js web app (TypeScript)

- Pros: no new deployable and no new language.
- Cons:
  - contradicts ARCH-2 ("Go: game server");
  - Next.js route handlers don't hold long-lived sockets well on Fargate or behind its server;
  - the web app's scaling becomes tied to live matches.
- Cost to reverse: high.

## Recommendation (not a decision)

**A**, as the owner answered. LOAD-2 and ARCH-2 name the actor model and Go outright. The ticket keeps Go away from the auth database, as Q-P3-01 asks, and ADR-0011 is met by the same binary with a different front proxy per mode. B is the fallback only if a fixed set of servers ever fails to scale, and LOAD-2 would have to change first.

Accepted by the owner on 2026-11-02: option A.

## Consequences

If A is accepted:

- **P3-W15-S01 is unblocked:**
  - `services/game` with `gofmt`, `go vet` and `go test` in `pnpm check` and CI;
  - a Dockerfile, and a `/healthz` endpoint;
  - a compose service with a Caddy route in `deploy/compose.prod.yml`;
  - a CDK Fargate service `game-0` with an ALB rule for `/game/0/*`;
  - env: `GAME_SERVER_ID`, `GAME_TICKET_SECRET`, `VALKEY_URL`.
- W15-S02 adds ticket signing to the web app and checking to Go, from one shared format with tests on both sides that read the same fixtures. That isn't "implemented twice": signing lives in TypeScript and checking in Go.
- New secret: `GAME_TICKET_SECRET`, in `.env.example` and the secret lists of both modes.
- A Go toolchain in CI (actions/setup-go) and in local setup docs.

## Open questions

Answered by the owner, 2026-11-02:

- **Go WebSocket library:** `github.com/coder/websocket` (ISC licence) may be added.
- **Ticket lifetime and ALB idle timeout:** not asked, so the suggested defaults stand until the owner says otherwise: 60 seconds to connect; a 120-second idle timeout with a 25-second ping from the server.
