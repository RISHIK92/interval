# Phase 5 questions

Drafted 2026-11-12, during an overnight run. The owner said to "continue building with recommended answers overnight", so every answer below is its suggested default, marked **Answer (overnight, recommended)**. The owner reviews each one. A changed answer reopens the slices that cite it.

These questions cover Phase 5 (docs/roadmap/phase-5.md), LLD battles in Weeks 28–35. The blueprint gives this phase eight weekly lines. EXEC-1 to EXEC-5, LLDQ-1 to LLDQ-4, MATCH-1, MATCH-6, MATCH-7, BOT-5, LOAD-2 to LOAD-5 and product.md §6.5–§6.9 decide more. These questions fix what the docs leave open.

Priority: **P0** blocks the week's first slice; **P1** blocks a later slice; **P2** can wait.

## Week 28: the engine

### Q-P5-01 Where the execution engine lives (P0 for W28)

- Cite: ARCH-1 ("Phase 5 adds the code execution engine"), ARCH-2 ("Go: game servers and the execution engine"), EXEC-1 ("a hardened Velox and … Judge0"), EXEC-2 ("Velox integration").
- Why it matters:
  - Velox is the owner's separate repository (`RISHIK92/velox`). It has other contributors and no licence file. Its API takes API keys and has its own users and Postgres.
  - Interval's checks, tests and deploys cover only this monorepo.
- Suggested default:
  - a new Go service, `services/exec`, in this repo, written fresh to Velox's design: a strategy per language, compile once, run a batch;
  - no Velox code copied (licence and authorship), and no edits to the Velox repository;
  - Judge0 is the comparison engine only, run from its published image for the red-team suite (W28-S04, owner-run: it needs a privileged Linux Docker host).
  - "A hardened Velox" in EXEC-1 is read as this service. ADR-0039 (PROPOSED) records it.
- **Answer (overnight, recommended):** the suggested default; ADR-0039 PROPOSED.

### Q-P5-02 What isolates one run (P0 for W28)

- Cite: EXEC-3 (every rule), EXEC-5 (ECS on EC2, isolated subnet).
- Suggested default:
  - every run is a fresh container started by the exec service through the `docker` CLI on its own host (no SDK dependency; P5-W28-S01), with:
    - `--network none` and `--read-only`;
    - a size-capped `--tmpfs /tmp` (noexec off, so compiled code can run);
    - `--user 65534` and `--cap-drop ALL`, plus `--security-opt no-new-privileges`;
    - `--pids-limit`, `--memory` (and the same `--memory-swap`) and `--cpus`;
    - an empty environment;
  - input only on stdin, and output read with a size cap;
  - a wall-clock kill, then the container removed;
  - on EC2 hosts, the container runtime is gVisor (`runsc`). Locally it's Docker Desktop's default (runc), and the checklist says so.
  - The exec service talks to Docker over its own host's socket, so it runs only on the isolated execution hosts (EXEC-5), never beside the web or the worker.
- **Answer (overnight, recommended):** the suggested default.

### Q-P5-03 The red-team suite's pass bar (P0 for W28)

- Cite: EXEC-1 (the attacks named), the "Done when" ("no sandbox escapes").
- Suggested default:
  - one attack program per attack and language family. The attacks are:
    - network, both DNS and a TCP connect;
    - a fork bomb;
    - reading the environment;
    - listing other processes;
    - writing outside `/tmp`;
    - reading another run's files;
    - exhausting memory;
    - an infinite loop;
    - output flooding;
    - a forbidden syscall (`mount`), and reading the host (`/proc/1/environ`, the Docker socket).
  - Each attack has an expected safe verdict: a failure, a limit hit, or nothing found.
  - A single unsafe result fails the engine.
  - The suite is a Go test package that runs against any engine through a small adapter. It reruns in CI against `services/exec` (as a non-required job, since CI's Docker can't run gVisor), and before every release.
- **Answer (overnight, recommended):** the suggested default.

### Q-P5-04 Which language images (P0 for W28)

- Cite: product.md §6.5 and C-04 (Python, JavaScript/TypeScript, Java, C++, Go), EXEC-2 ("add a Go language strategy").
- Suggested default:
  - one runner image per language, from official images pinned by digest:
    - `python:3.13-slim`;
    - `node:22-slim` (TypeScript through Node 22's type stripping, with no extra compiler);
    - `eclipse-temurin:21-jdk`;
    - `gcc:14`;
    - `golang:1.25`;
  - each with nothing added but a non-root user;
  - each at least two weeks old (the owner's rule).
- **Answer (overnight, recommended):** the suggested default.
- **Built differently in P5-W28-S03, for the owner to confirm:**
  - Java is `eclipse-temurin:21.0.12.1_1-jdk` and C++ is `gcc:14.3.0`. The current `21-jdk` and `14` builds were under two weeks old.
  - Go is `golang:1.27.3-alpine` (the game server's pin), not 1.25.
  - Go adds one thing beyond a user: a build cache warmed for common packages (`services/exec/images/go`). A cold `go build` in the sandbox took 40 s; with the cache it takes 2–3 s.
  - Each image's own entrypoint is disabled (`--entrypoint ""`).

### Q-P5-05 Warm pools (P1 for W28)

- Cite: the Week 28 roadmap line ("warm pools"), EXEC-2 ("Speed").
- Suggested default: no container is reused between runs (EXEC-3, "a fresh sandbox"). Warm pools mean:
  - language images pre-pulled on every execution host at boot;
  - a minimum number of execution hosts kept warm during windows (W32's scheduled scaling).
- **Answer (overnight, recommended):** the suggested default.

## Week 29: interfaces and harnesses

### Q-P5-06 The interface schema (P0 for W29)

- Cite: LLDQ-1 ("a language-neutral interface schema … generated dispatch code instead of reflection"), ADR-0010 (JSON Schema codegen).
- Suggested default:
  - a problem's interface is JSON: one class with a constructor and methods, typed with a small type set:
    - `int`, `float`, `bool`, `string`;
    - `list<T>` and `map<string,T>`;
    - `optional<T>`.
  - A scenario is a list of calls; the harness prints each call's result as JSON lines.
  - The schema of these files lives in `packages/lld` as JSON Schema with generated TS and Go types.
  - Generators written in TypeScript (`packages/lld`) emit starter code and harnesses for the five languages, committed per problem and checked for staleness.
- **Answer (overnight, recommended):** the suggested default.

- **Built differently in P5-W29-S01, for the owner:** zod in `packages/lld` is the source; the JSON Schema and Go types (with generated validation) come from it. ADR-0040 (PROPOSED) records this.

### Q-P5-07 The external checker (P0 for W29)

- Cite: EXEC-4 ("Checking happens outside the sandbox. A trusted checker replays the reference solution and checks invariants on the raw results.").
- Suggested default:
  - the checker is Go, in `services/exec`, outside any sandbox;
  - for each scenario it compares the submission's raw results with the reference solution's results, recorded once when the problem is published and stored with the hidden tests, rather than replayed live on each submit;
  - it then runs the problem's invariant checks (declared in the problem file: equality, set equality, ordering, ranges);
  - only a category and pass or fail per layer go back (LLDQ-4).
- **Answer (overnight, recommended):** the suggested default.

## Week 30: problems

### Q-P5-08 Who writes problems, and how they're checked (P0 for W30)

- Cite: LLDQ-2 (references in five languages, mutation testing on the Python one), LLDQ-3 (property tests, concurrency rules), the "Done when" ("every problem's tests catch at least 90% of injected bugs").
- Suggested default:
  - problems are YAML files in `problems/lld/<slug>/`: statement, interface, visible tests, hidden tests, concurrency tests, extension round, and five reference solutions;
  - they are written by Claude during the build, PROVISIONAL, and the owner reviews them before launch. No model writes problems at runtime;
  - mutation testing uses `mutmut`, pinned as a dev-only Python dependency, on the Python reference. The 90% bar is a test;
  - property tests use Hypothesis on the Python reference;
  - each language runs its concurrency tests (threads for Java, C++, Go and Python; interleaved async for JS/TS, §6.5).
- **Answer (overnight, recommended):** the suggested default.

## Week 31: the battle

- **Built differently in P5-W30-S01, for the owner:** problems are JSON (`problem.json`, with `statement.md` and `references/` beside it), not YAML. The repo has no YAML parser on the TS side, and its zod contract validates JSON directly. The expected results are recorded in `expected.json` by `verify`.

- **Built differently in P5-W30-S02, for the owner:** no `mutmut` or Hypothesis. Mutants come from a standard-library `ast` mutator (`packages/lld/tools/mutants.py`). The property tests are differential: seeded random scenarios on which every language's reference must agree with Python's. There is no new dependency. The 90% gate counts every mutant except changes to constants inside a `raise` or an annotation: errors are compared by kind only, so those can never be caught.

### Q-P5-09 Who runs a battle (P0 for W31)

- Cite: LOAD-2 (the match-actor model), ADR-0033 (the Go game server), LOAD-3 (the execution queue's priorities).
- Suggested default:
  - the Go game server owns a battle's lifecycle, as it owns quick matches: rounds, the extension round's reveal, the clock and snapshots;
  - submissions go to a Valkey priority queue (`exec:ranked`, `exec:rooms`, `exec:casual`, `exec:run`, ADR-0014), served in that order by `services/exec`;
  - verdicts come back on a reply list;
  - Run executes visible tests only and is never scored; Submit runs every layer.
- **Answer (overnight, recommended):** the suggested default.

### Q-P5-15 The battle's clock, scoring and judging (P0 for W31-S02)

- Cite:
  - §6.5: "take about 45 minutes", "Extension rounds: requirements change mid-match", "Scoring: weighted tests passed, then time".
  - Q-P5-09 (who runs a battle). Its queue answer predates ADR-0041 (PROPOSED: Velox judges).
- **Answers (owner, 2026-11-12):**
  - **Clock:** 30 minutes on the base problem. Then the extension is revealed to every player at once, and 15 minutes remain. A submission is judged on the layers live when it was made: the base layers before the reveal, the base plus the extension after.
  - **Weights:**
    - visible 10%, hidden 40%, concurrency 20%, extension 30%;
    - each layer's weight is split evenly across its scenarios;
    - ties are broken by the time of the best submission.
  - **Submissions:** Submit is unlimited, with a 30-second cooldown, and the best-scoring one counts. Run (visible tests only, never scored) has a 5-second cooldown.
  - **Judging:** the Go game server owns the battle. It sends Run and Submit to Velox's `POST /judge` over HTTP, reads the result, scores it, and pushes the verdict over the match's WebSocket. Interval's judge client is in Go, in `services/game`.

### Q-P5-16 A battle's disconnects, end, feedback and result (P0 for W31-S02b-2)

- Cite:
  - MATCH-6: "a 10-second reconnect grace period, abandon penalties".
  - LLDQ-4: "Hidden tests never reach the client. Results show only their category."
  - §6.5 (45-minute battles); §6.6 (Glicko-2 for 1v1, OpenSkill for rooms; ratings come in W32).
- **Answers (owner, 2026-11-13):**
  - **Disconnects:** after the 10-second grace, a player is shown as away, but the battle goes on. Their best submission stands, and they may come back any time before it ends. A player is abandoned only if they never return and never submitted.
  - **Early end:** a battle ends early once every player still in it has full points after the reveal, or nobody is left; otherwise at 45:00.
  - **Feedback:**
    - **Run** (the visible tests): each test passed or failed, with the first mismatching call and its reason, or the run's verdict (a compile or runtime error).
    - **Submit:** the points, and passed/total per layer, with no hidden detail.
  - **Results:** the game server sends `match_finished` for a battle (points, best-submission times, the winner). The worker stores it, and ratings start in W32 from the stored results.

### Q-P5-10 The editor (P0 for W31)

- Cite: the Week 31 roadmap line ("the Monaco editor"), §6.5 ("desktop browsers").
- Suggested default:
  - `monaco-editor`, pinned, loaded only on the battle page;
  - no language servers, only syntax highlighting;
  - paste, focus and 30-second snapshot signals for fair play in the human league (§6.9), sent as DB-5 events. Snapshots go to the private bucket (DB-6).
- **Answer (overnight, recommended):** the suggested default; the dependency is listed in progress.md.

### Q-P5-17 A battle's fair-play signals (P0 for W31-S04)

- Cite:
  - §6.9: "paste events, focus changes, … code snapshots every 30 seconds. Flags go to review before any penalty".
  - §6.2: two leagues for battles; signals apply to the human league only.
  - Q-P5-10 (signals "sent as DB-5 events"), DB-6 (snapshots in S3), and the quick games' signals (P3-W18-S02).
- **Answers (owner, 2026-11-13):**
  - **Flag rule:** a player is flagged for review on any paste of 200 or more characters that isn't already in their editor, or on 5 or more focus losses of 30 seconds or longer. Short pastes and quick glances never flag.
  - **Snapshots:**
    - The page posts its code every 30 seconds to `/api/battle/[id]/snapshot`, and only a player in an unfinished match can post. The web's FileStore writes it to the private bucket.
    - Snapshots are deleted after 90 days, or kept until a flag on that match is decided.
    - **Clarified (owner, 2026-11-13, W31-S04b-2):**
      - whichever is later: at least 90 days, and longer while a flag on the match waits for review;
      - the bucket is versioned, so a deleted snapshot stays a noncurrent version for 30 more days before S3 expires it (about 120 days in all), as books do. No role may delete versions.
  - **Path:** signals go with the match result, as quick games' do (`game_match_player.signals`, read by `/admin/fair-play`). The page sends paste and focus over the match socket, and the worker stores them and raises flags. No analytics event carries them. This replaces Q-P5-10's "sent as DB-5 events".
  - **League:** every battle is in the human league until W32. W32 adds the league, and the AI league's battles then skip signals.

## Week 32: rooms and windows

### Q-P5-11 OpenSkill (P0 for W32)

- Cite: MATCH-1 ("OpenSkill for rooms"), ADR-0034 (ratings computed in the Python worker).
- Suggested default:
  - `openskill` (Python), pinned, in the worker, the Plackett-Luce model;
  - battle ratings are separate per league (§6.2) and from quick games.
- **Answer (overnight, recommended):** the suggested default.

### Q-P5-18 Battle ratings (P0 for W32-S01)

- Cite: MATCH-1 ("Glicko-2 for 1v1, OpenSkill for rooms"), ADR-0034 (ratings in the Python worker), §6.6 ("with seasons and soft resets"), Q-P5-11, Q-P5-16 ("ratings start in W32 from the stored results").
- **Answers (owner, 2026-11-13):**
  - **Two ratings:** a 1v1 battle rating (Glicko-2) and a room rating (OpenSkill), each per league, both separate from quick games.
  - **A room's order:** the best submission's points, ties to whoever reached them first. Equal points and time share a rank, and abandoned players rank last, together.
  - **Seasons:** battle ratings are soft-reset monthly with quick games, at the same season close.

### Q-P5-19 Windows' grouping, the casual queue, scaling and reminders (P0 for W32)

- Cite: §6.6, MATCH-7, LOAD-4, EXEC-5, ADR-0041, Q-P5-12.
- **Answers (owner, 2026-11-13):**
  - **Grouping:** at a window's start, registrants are sorted by room rating and cut into rooms of 4. A remainder of 3 is a room of 3 and 2 is a 1v1; a remainder of 1 plays solo, unranked. Everyone in a window gets the same random problem.
  - **Casual:** an unrated 1v1 battle. After 60 s with nobody, the player plays it alone, unrated, against a "reference pace": when a strong solver typically passes each layer, fixed per problem (visible by 10:00, hidden by 25:00, extension by 40:00).
  - **Scaling:** Interval's AWS stack scales the game server up 10 minutes before each window and down after it. Velox's hosts are Velox's own concern, and the VM does nothing.
  - **Reminders:** only registered players get the window's reminder push (Q-P5-12's kind, off until opted in), 15 minutes before.
- **Process (owner, 2026-11-13):** from W32 on, a roadmap week is built and committed as one unit (questions once, one review), to finish the product sooner.

### Q-P5-12 Windows (P1 for W32)

- Cite: §6.6 ("nightly per region plus weekends, with registration and reminders"), MATCH-7, LOAD-4.
- Suggested default:
  - one region (the deployment's own; there is one today);
  - a window nightly at 21:00 local to the region, plus 11:00 on Saturday and Sunday, 45 minutes each;
  - registration closes 5 minutes before the start;
  - the reminder push is a new kind, off until opted in (Q-P4-13's rules), sent 15 minutes before;
  - EventBridge Scheduler, or the VM's timer, scales execution hosts 10 minutes before a window.
- **Answer (overnight, recommended):** the suggested default.

## Week 33: the AI league

### Q-P5-13 "Ask the interviewer" (P1 for W33)

- Cite: §6.2 ("vague requirements with an 'ask the interviewer' channel"), AI-2, OPS-4.
- Suggested default:
  - a question box during AI-league battles only;
  - answered by `QUESTIONS_MODEL` through the gateway, from the problem's hidden "interviewer notes" in its YAML;
  - capped at 10 questions a battle;
  - labelled AI, and logged for review.
- **Answer (overnight, recommended):** the suggested default.

### Q-P5-20 The AI league, battle boards and code similarity (P0 for W33)

- Cite: §6.2 (leagues), §6.7 (season boards), §6.9 (code similarity), Q-P5-13, Q-P5-18.
- **Answers (owner, 2026-11-13):**
  - **AI-league problems:** the format gains a league tag, interviewer notes, up to 3 extension rounds revealed at 20:00, 30:00 and 38:00, and a `failure` layer whose scenarios inject errors from collaborators (a store that times out or throws) for the solution to handle. Claude writes 2 PROVISIONAL AI-league problems (references in six languages, verified, mutation-gated) for the owner's review.
  - **Choosing a league:** a Human/AI toggle in the battle lobby, for the casual queue (a queue per league) and window registration (a grouping per league, at the same times).
  - **Battle boards:** season boards per league on /play/boards, for the 1v1 rating (Glicko) and the room rating (OpenSkill ordinal, mu − 3σ). Global only. The season close keeps their final standings, as for quick games.
  - **Code similarity (human league):** after a battle, each pair of players' best submissions in the same language is compared by normalized token similarity (identifiers and literals masked). 85% or more of the shorter one's tokens in common is a `similar` signal on both, which flags for review. Nothing across matches yet.

## Week 35: results

### Q-P5-14 The AI code review (P2 for W35)

- Cite: §6.5 ("An optional AI code review appears after the match and never affects ratings"), AI-1.
- Suggested default:
  - generated on request after the match by `QUESTIONS_MODEL`;
  - labelled AI, and stored apart from the code;
  - within the OPS-4 budget;
  - shown only to the code's author.
- **Answer (overnight, recommended):** the suggested default.
