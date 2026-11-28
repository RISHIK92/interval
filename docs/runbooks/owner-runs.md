# The owner's runs (2026-11-19)

Verified by reading the repo and ~/velox (nothing was run). Env vars are names only. Run all `pnpm`/`scripts/with-env.sh` commands from the interval repo root. Record every run in docs/progress.md.

Common base: `brew install k6` (present at /opt/homebrew/bin/k6), `docker compose up -d --wait`, `pnpm db:migrate`, `pnpm problems:load` (LLD only).

## 1. LLD window-start load test (LOAD-4, P5-W34-S02)

Goal: p95 verdict under 10 s, zero failures.

Needs first

- Interval `.env`: `DATABASE_URL`, `VALKEY_URL` (load:prepare reads it), `GAME_TICKET_SECRET` (32+ chars; empty in .env.example, so set it; k6 mints tickets with it), `VELOX_URL`, `VELOX_API_KEY`.
- Velox running, with that key's ID in Velox's `JUDGE_API_KEY_IDS` (Velox's own .env). Velox must have passed its red-team (see section 4) before real player code is trusted.
- Game server as server 0 on port 8080 (script connects to `/game/0/ws`). Not in the runbook; from phase-3-checklist:
  `cd services/game && GAME_SERVER_ID=0 PORT=8080 VALKEY_URL=... GAME_TICKET_SECRET=... VELOX_URL=... VELOX_API_KEY=... go run .`
  (or export them via `scripts/with-env.sh`).
- Problems' private files in the bucket (`pnpm problems:load`).

Commands

```sh
pnpm load:prepare lru-cache 200 /tmp/battles.json
# within about a minute (battle clocks start when players arrive):
scripts/with-env.sh k6 run -e BATTLES=/tmp/battles.json scripts/load/window-start.js
# other game server: add -e GAME_URL=ws://host:8080
```

Reading: `verdict_ms` p95 < 10000 and `verdicts_failed` count == 0; k6 exits non-zero if either fails. Note p95, p99, failures.
Record: date, players, p95, p99, failures, where Velox ran (workers and host).
Cleanup: `delete from app_user where id like 'load-%'` (cascades); `rm /tmp/battles.json`. Players are `load-<run>-<n>`, unrated.

## 2. HLD round load test (P6-W44, Q-P6-08)

Goal: p95 submit round trip under 2 s, zero failures. No Velox, game server or worker needed.

Needs first

- `.env`: `DATABASE_URL`, `BETTER_AUTH_SECRET` (hld-load-prepare signs cookies with it), `BETTER_AUTH_URL` (http://localhost:3100), plus the web app's usual env.
- Web app as a PRODUCTION build, not `next dev`:
  `pnpm turbo build` then `scripts/with-env.sh pnpm --filter @interval/web start --port 3100`

Commands

```sh
pnpm load:hld 200 /tmp/hld-round.json
# within the round's 30 minutes:
scripts/with-env.sh k6 run -e ROUND=/tmp/hld-round.json scripts/load/hld-round.js
# other web app: -e WEB_URL=https://...
```

Reading: `submit_ms` p95 < 2000; `submits_failed` count == 0; `autosave_ms` is context only. Judge jobs just queue.
Record: date, players, p95, p99, failures.
Cleanup: delete /tmp/hld-round.json (live session cookies), then the SQL block at the end of docs/runbooks/load-test.md (retired variants, `hld_tournament` named `Load %`, matches, `app_user like 'load-hld-%'`, `invite_code like 'HLDLOAD%'`). Cookie name has no `__Secure-` prefix, so it works over plain HTTP only.

## 3. HLD judge agreement eval (CANVAS-6, AI-5, Q-P6-05)

Pass: at least 85% of rubric levels within 1 of your grade, and no injection design graded above you. It calls a real model and spends budget.

Needs first

- Local stack up, migrated. Web app running (to grade).
- `OPENROUTER_API_KEY` set (the gateway needs it; the runbooks don't list it). Pick a model id for `--model`.
- Grade every criterion of the calibration set (about 50 designs, `packages/hld/src/calibration.json`) at `/admin/hld-calibration` as the owner. Only fully graded designs count; resolved appeals are added automatically.
- AI budget (global and per-user) high enough; the eval stops with "the <scope> AI budget is spent" otherwise.

Command

```sh
scripts/with-env.sh uv run python -m interval_jobs eval-hld-judge --model <openrouter-model-id> [--candidates F]
```

Reading: prints the report (designs, levels, exact, within_one, mean_difference, steered, unjudged, passed); passes at within_one >= 0.85 and no steered. It stores nothing; the cost goes to the global budget.
Record: model, date, designs/levels, within_one, exact, mean difference, steered, unjudged.
Cleanup: none. A cup counts on the rubric only after a pass (hld-cup.md).

## 4. Velox red-team rows (EXEC-1, EXEC-5)

Source: ~/velox/docs/runbooks/redteam.md. Both rows read "owner to run"; no player code runs on Velox until the gVisor row is in. 22 attacks (13 Python, native probes for JS/TS/C++/Go, Java's); any unsafe result loses.

gVisor row (an execution host with gVisor installed and registered as Docker's `runsc` runtime; Linux)

```sh
cd ~/velox
docker build -q -t velox-exec-go:1 build/images/go
cd backend && EXEC_RUNTIME=runsc EXEC_INTEGRATION=1 go test -p 1 -count=1 -v ./redteam/
```

Needs: Docker, Go, `EXEC_RUNTIME=runsc` (read by backend/redteam/redteam.go). Run it with nothing else using Docker (a loaded host made Go's memory hog hit `time_limit` on 2026-11-14). Fill the gVisor row of the Runs table; record in interval docs/progress.md.

Judge0 row (throwaway Linux VM with Docker; cgroup v1: boot with `systemd.unified_cgroup_hierarchy=0`)

1. Unpack Judge0 CE `judge0-v1.13.x.zip`; set passwords in `judge0.conf`; caps: `MAX_MAX_FILE_SIZE` >= 4096, `MAX_MEMORY_LIMIT` >= 131072, `MAX_MAX_PROCESSES_AND_OR_THREADS` >= 64, `MAX_CPU_TIME_LIMIT` and `MAX_WALL_TIME_LIMIT` >= 5.
2. `docker compose up -d db redis`, then `docker compose up -d`.
3. `cd ~/velox/backend && JUDGE0_URL=http://<vm>:2358 go test -count=1 -v -run Judge0 ./redteam/` (only the 13 Python attacks apply).
4. Sort each UNSAFE line: real escape (loses), missing EXEC-3 control such as no seccomp (counts against), layout mismatch (doesn't count, note it).
5. Fill the Judge0 row; tear the VM down.
   Decision: any unsafe result loses; if both pass, Velox stays.
   Note: the Judge0 go test names `-run Judge0` also match 3 unit tests in judge0_test.go that use fakes; the real suite is the one gated on `JUDGE0_URL`.

## 5. Stand-alone question stems (Q-1, owner 2026-11-23)

Rewrites each live question, multiple-choice or estimate, whose stem refers to its passage ("According to the passage, ..."), since sprints, the daily challenge, matches and battles show the question alone. For each one, QUESTIONS_MODEL (a `batch:` prefix is dropped: one call at a time) gets the article's text as drafting reads it (only under a full-text rights profile, ING-2) and the old stem, with the options and the key (an estimate: its answer and unit), and is told not to give the key away. It returns a stand-alone stem. A stem that still refers to its source, or holds the correct option's words (whole words, case and punctuation aside) or an estimate's answer, is refused. Otherwise the blind validator answers the new stem again: a multiple-choice one must pick the key; an estimate must land within the drafting rule's factor of the answer (`ESTIMATE_AGREES`, 1.25 either way). Only then is the new stem saved. It calls a real model and spends the global AI budget (two calls per question).

What a saved rewrite changes: the stem; `prompt_version` set to 1001 (`REWRITE_PROMPT_VERSION`: the rewrite's v1, past any draft's 1, 2, ...); `validator_model` and the validator's answer (or number); `validated_at` set to now, so the rewritten question enters the spot-check sample (Q-2) as new AI text should. What it keeps: `generator_model` (the model that drafted the options and the key), the options, the key, an estimate's answer and unit, and the citation.

Needs first: local stack up and migrated (`stem_rewrite_tried_at`, migration 20261123110000), `QUESTIONS_MODEL` and its provider's key set, and a global AI budget high enough.

```sh
scripts/with-env.sh uv run python -m interval_jobs rewrite-stems [--limit N] [--retry-days D]
```

Which questions a run takes: every question sent is marked tried (`stem_rewrite_tried_at`), whatever came of it, except when the budget stops the run. A run takes the never-tried ones first (oldest question first), then those whose last try is more than `--retry-days` ago (default 7; oldest try first), and skips the rest. `--limit N` sends at most N of those, so each limited rerun moves on to questions not tried yet instead of paying again for the same failures. `--retry-days 0` tries every failed one again at once.

Reading: prints `rewritten`, `disagreed` (the validator picked another option or number; left as it was), `broken` (the reply, or the validator's, broke a rule: still refers to its source, gives the key away, not the JSON asked for), `errors` (model errors), `no_text` (the article's rights or tags no longer allow its text), `options_refer` (an option itself refers to the source, so a new stem can't fix it; these are never sent and need a review or a redraft), `changed` (its stem changed while it was being rewritten; left as it is now), `cooling_off` (tried within `--retry-days`; not sent this run) and `stopped`. Every rewrite is logged with its old and new stem.
Exit: when the budget runs out, the run stops with "the global AI budget is spent" and exits non-zero. When model errors happened, the run finishes and then exits 2, so an outage isn't taken for a clean run.
Rerun: safe. A rewritten stem no longer matches, so a rerun carries on with what is left; failed ones wait out `--retry-days`.
Note: PROMPT_VERSION stays 1, so the question bank isn't redrafted: new drafts that name their source are refused at parse time, and this command fixes the existing ones.

## Flags (missing or inconsistent)

- load-test.md never says how to start the game server nor that `GAME_SERVER_ID=0` is required (the script hardcodes `/game/0/ws`); `GAME_SERVER_ID` is not in .env.example.
- `GAME_TICKET_SECRET` is empty in .env.example; k6 throws if unset.
- load:prepare also needs `VALKEY_URL` (runbook lists only DB/stack).
- HLD eval needs `OPENROUTER_API_KEY` and a `--model` value; hld-cup.md and phase-6-checklist say "with QUESTIONS_MODEL set", but the command ignores it (`--model` is required).
- The HLD web start line omits `scripts/with-env.sh`.
- The redteam.md gVisor row says "the same, with `EXEC_RUNTIME=runsc`" without the full command or the runsc install step (added above).
- redteam.md's Runs table is Velox-repo only; Interval's progress.md is where the checklists expect the record.
