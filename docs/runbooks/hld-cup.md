# Running an HLD cup (Phase 6, Week 45)

Week 45 is the owner's: first a practice cup with beta universities, then the first University Cup. This runbook covers both. The rules are Q-P6-07:

- 5 Swiss rounds of 1v1 HLD matches, then the top 8 in a bracket (4 or 2 when fewer check in);
- a university's score is its top 5 members' Swiss points.

## Before the cup

1. **Problems.** Review the 3 hand-written cup problems (`packages/hld/src/families.ts`, `CUPS`, PROVISIONAL) and the families' numbers in spec v1.0 (`/hld/spec`).
   - A cup needs 8 problems, one per round. Use the cups for the bracket, and pooled variants (or more hand-written cups) for the Swiss rounds.
   - Every pick is retired from matchmaking as the tournament is made (HLDQ-3), so don't reuse one across cups.
   - A cup problem is only listed for the leagues it validated in: concert tickets and ride dispatch are human-league only, while live scores is both.
2. **The judge.**
   - Grade the calibration set at `/admin/hld-calibration`.
   - With `OPENROUTER_API_KEY` in `.env`, run `scripts/with-env.sh uv run python -m interval_jobs eval-hld-judge --model <model id>` (the model is named on the command, not taken from `QUESTIONS_MODEL`).
   - It must pass, with at least 85% of levels within one of yours and no steered injection design, before a cup counts on the rubric.
   - Keep the per-user AI budget high enough for 4 calls per player per round.
3. **Load.** Run the round load test in `docs/runbooks/load-test.md` with about the cup's expected field, against a production build. It needs p95 under 2 s.
4. **The worker.**
   - `consume` must run during the cup: it writes every judgement and coaching, and rates matches (tournament matches are unrated, but casual ones aren't).
   - A missing judgement after 15 minutes leaves the rubric out of that match for both players; watch the `Interval/Hld ScoredWithoutRubric` metric.
5. **Players.** Each player picks their university on their profile before checking in: it's fixed at check-in.

## Making the cup

At `/admin/hld-tournaments`, under "New tournament":

- give it a name and a league;
- set the start in UTC (check-in opens an hour before);
- pick the 8 rounds' problems (rounds 1–5 Swiss, then the quarter-finals, semi-finals and final).

Share `/hld/tournaments/<id>`. Players register there, and check in during the hour before the start.

## Running it

- **Round 1:** at the start, press "Start round 1". Players who checked in are paired, and an odd one out gets a bye. Players find their match on the tournament page.
- **Each round** takes about 30 minutes, plus up to 15 for the judge.
  - Press "Start the next round" when the page says the round is scored.
  - It answers "waiting" while any match is still open, and "busy" if another admin pressed first.
  - A round whose matches weren't all started (a crash, the queue down) is finished on the next press; press again.
- **After round 5** the next press seeds the bracket from the Swiss standings (ties broken by Buchholz, then match totals). The final's press after that finishes the cup.
- **Spectators** can watch any match they aren't playing in at its "watch" link, and replay any match once its round is over.

## Afterwards

- **Appeals** arrive at `/admin/hld-appeals` for 7 days. Re-grade each criterion. Phase 6 wants under 5% of results appealed (the page shows the 30-day rate).
- An appeal resolved after a match was scored doesn't re-score it or move standings. The cup's results stand unless you correct them by hand. "The first cup finishes without a rejudge" is Phase 6's last goal.
- Record the cup in progress.md: entrants, rounds, any "waiting" or "busy" surprises, the appeal rate, and the ScoredWithoutRubric count.
