# 0035. The agent hook CLI is a Go binary, authenticated by a device token

- Status: ACCEPTED
- Date: 2026-11-03
- Supersedes: none (amends ARCH-2's list of Go's jobs)
- Superseded by: none

## Context

§7 (docs/product.md), "Agent-waiting surfaces":

> 1. When the agent starts, the hook tells Interval a task has begun.
> 2. If the agent is still running about 45 seconds later, a notification offers a quick session.
> 3. When the agent finishes, Interval saves your place.
>
> It sends only "started" and "finished" events, never prompts or code. `interval start` and `interval stop` let it work with any agent.

ARCH-2 (docs/decisions.md) gives each language a strict job:

> **Go:** game servers and the execution engine.

The CLI fits none of these jobs as written.

Q-P3-17 (docs/questions/phase-3.md), owner's answer of 2026-10-31: "a Go binary. ARCH-2 lists Go for the game server and execution engine only, so the CLI's language goes in an ADR (it can share the game server's toolchain and CI). Distribution and auth still open: suggested a device token made on Profile, binaries on GitHub releases; ask before publishing."

Related:

- **P3-W17-S04 (done):** the API the CLI calls.
  - `POST /api/agent/started` and `/api/agent/finished`, with `Authorization: Bearer ivd_…` and a strict body `{"idempotency_key": "…"}`. Any other field is refused.
  - Device tokens are named on Profile, shown once and kept hashed, up to 10 per account (Q-P3-28).
- **C-09** (ADR-0006): the hook sends started and finished only; there is no task-topic switch.
- **C-10:** elapsed time only.
- **Q-P3-18:** the 45 s notification comes both from the CLI itself and as web push to the PWA. Web push needs a new dependency, which must be asked about first.
- **ADR-0013:** nothing is deployed or published until all phases are built.
- **docs/open-decisions.md item 7** ("Agent integrations beyond Claude Code") is touched here, not settled: the CLI works with any agent that can run a command at start and finish.

## Options

### A. A Go binary in this repository (`cli/interval`), its own Go module, built and tested beside `services/game`

`interval start` and `interval stop` each send one request:

- They read the token from `INTERVAL_TOKEN`, else from `~/.config/interval/token` (mode 0600, written by `interval login <token>`).
- The site comes from `INTERVAL_URL`.
- Each sends a fresh idempotency key and retries the same key on a network error.
- A request times out after a few seconds and never blocks the agent; the exit code is 0 unless the token is bad.

`start` leaves a detached waiter. After 45 s, if no `stop` has happened since (a marker in the user's cache directory), it shows the OS notification: `osascript` on macOS, `notify-send` on Linux, a toast on Windows, with a link to Interval.

- **Pros:**
  - one static binary per platform, with no runtime for the user to install;
  - the toolchain is already present (Go 1.24, `go vet`, `gofmt` and `go test -race` in CI for `services/game`);
  - it's the owner's answer;
  - a test can assert the CLI's request bodies hold only the key.
- **Cons:**
  - ARCH-2 needs this amendment;
  - cross-compiled builds per OS and architecture;
  - OS notifications differ per platform (three small code paths).
- **Cost to reverse:** low. The CLI is a client of a stable HTTP API: about 300 lines that another language could replace without a server change.

### B. TypeScript on npm (`npx interval-hook`), the suggested default in Q-P3-17

- **Pros:**
  - no new language job;
  - most developers already have Node.
- **Cons:**
  - Node's startup on every agent start and stop;
  - an npm package to publish and maintain (outward-facing);
  - the detached 45 s waiter is awkward under `npx`;
  - the owner chose against it.
- **Cost to reverse:** low.

### C. A shell script (`curl`)

- **Pros:**
  - nothing to build;
  - readable at a glance.
- **Cons:**
  - Windows is left out;
  - the detached waiter and notifications in POSIX shell are fragile;
  - retries and idempotency keys are hand-rolled;
  - hard to test the "two events only" promise.
- **Cost to reverse:** low.

## Recommendation (not a decision)

**A.** It's the owner's answer to Q-P3-17, it needs no new runtime on the user's machine, and it reuses the Go toolchain and CI that ADR-0033 already brought in. The device token from Profile (P3-W17-S04) is the auth: no OAuth or browser flow, and revocable per device.

Distribution follows ADR-0013 and the owner's "ask before publishing". Binaries are built by a script into `dist/` and attached to a GitHub release only when the owner says so. Nothing is published by this slice.

What would change this: if the owner wants installation through a package manager the developers already use (Homebrew or npm) more than a single binary, B or a Homebrew tap of A.

Accepted by the owner on 2026-11-03: option A.

## Consequences

If accepted:

- **ARCH-2 now reads:** "Go: game servers, the execution engine, and the agent hook CLI". docs/decisions.md is not edited; this ADR records the amendment.
- **`cli/interval/`:** a Go module with `start`, `stop`, `login` and `version`, plus tests:
  - request bodies hold only the key;
  - a retry reuses the key;
  - a missing or bad token says so;
  - nothing is read from the agent's prompt or working directory.
- **CI:** the same Go steps as `services/game`.
- **`scripts/build-cli.sh`:** cross-compiles darwin/linux/windows × amd64/arm64 into `dist/` (ignored by git).
- **A setup note (`docs/agent-hook.md`):**
  - Claude Code hooks: `UserPromptSubmit` runs `interval start`, `Stop` runs `interval stop`;
  - any other agent runs the two commands around a task.
- **P3-W17-S05 is unblocked for the CLI.** Web push (Q-P3-18) still needs the owner's answer on its dependency.

## Open questions

Answered by the owner, 2026-11-03:

- Web push is written on `node:crypto` (RFC 8291 and VAPID), with no new dependency.
- The CLI shows no notification on Windows; there it only sends the two events.
- The Claude Code setup wires `UserPromptSubmit` to `interval start` and `Stop` to `interval stop`.

Still open:

- **Web push to the PWA (Q-P3-18).**
  - Option one is the `web-push` npm package. It brings new dependencies: the package plus its JWT and encryption helpers.
  - Option two is RFC 8291 encryption and a VAPID JWT written on `node:crypto`, about 150 lines with no dependency.
  - Which should it be?
- **The site the CLI talks to.** Set by `INTERVAL_URL` with no default, until there's a production domain (ADR-0013: nothing is deployed yet).
- **Windows notifications.** A PowerShell toast, or only a line on the terminal?
