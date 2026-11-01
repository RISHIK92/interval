# 0031. The daily challenge auto-publishes when unreviewed

- Status: ACCEPTED
- Date: 2026-11-01
- Supersedes: none (amends Q-2, for the daily challenge only)
- Superseded by: none

## Context

Q-2 (docs/decisions.md): "Spot checks: a random 10% sample weekly, plus everything flagged. The daily challenge is reviewed the day before." C-08 settles the question bank on the Oct 23 text: no human gate on everyday questions, but "Daily challenge uses hand-written review per Oct 23". §6.8: "Hand-written: used for the daily challenge review, tournaments, and seasons, and retired after use."

So the docs make the owner's review a gate on each day's set. They don't say what happens when the owner hasn't reviewed it by the day's start. §6.3 says the challenge is "the same set for everyone, one attempt" with "Score and streak". LOAD-4 says the daily challenge has a predictable start time. A missing set breaks every player's streak (Q-P3-07) for a reason the player can't control.

The owner's answer to Q-P3-06 (2026-10-31): "UTC day, 5 questions; an unreviewed set auto-publishes (its questions already passed the validator)." The question file notes that this changes Q-2 and needs an ADR before P3-W13-S05. P3-W13-S05's acceptance already assumes it: "an unreviewed set auto-publishes at the day's start (Q-P3-06, its ADR) and the owner is told".

Every question the set can draw from is already live: it passed Q-1's blind validator, and the hand-written ones were entered by the owner. So "unreviewed" here means the owner hasn't approved this day's _selection_. The questions themselves are not unchecked.

## Options

### A. Auto-publish the picked set at the day's start, and tell the owner (the owner's answer)

At 00:00 UTC, an unapproved set publishes as picked. The owner is told, and the event is logged with a metric (LOAD-5's "observable" rule). Every question in an auto-published set joins Q-2's "everything flagged" list, so it gets a human look after the fact.

- Pros:
  - The challenge always starts on time, so streaks never break because of the owner.
  - Uses only validator-passed or owner-written questions.
  - One code path: the set the owner would have reviewed is the set that runs.
  - Simple to build.
- Cons:
  - A wrong question can reach every player for one day before anyone looks. That is the risk Q-2's review exists to prevent.
  - §6.8's "hand-written ... used for the daily challenge review" is no longer a gate.
- Cost to reverse: low. A later change can swap the auto-publish for B's fallback inside the same job. The set table and the approval flag stay.

### B. Fall back to an already-reviewed reserve set (Q-P3-06's suggested default)

If the owner hasn't approved tomorrow's set by 00:00, publish a reserve set the owner approved earlier, and log the gap. Never publish an unreviewed set.

- Pros:
  - Keeps Q-2's gate as written: every published set was reviewed.
  - Streaks are kept.
- Cons:
  - The owner must keep a stock of reviewed sets. When it runs out, B fails the same way as having no fallback.
  - Repeats questions across days, or uses up reserve sets that were meant to be fresh.
  - Two code paths.
  - The owner chose against it in Q-P3-06.
- Cost to reverse: low. Same job, a different branch.

### C. No challenge that day

Publish nothing and show "No challenge today". Optionally, the streak skips the day.

- Pros:
  - Q-2's gate holds.
  - No reserve stock is needed.
- Cons:
  - Players lose a day of the main daily habit (§8's "daily challenge streaks" metric).
  - The streak must special-case blank days.
  - It contradicts the owner's answer.
- Cost to reverse: low.

## Recommendation (not a decision)

**A**, as the owner answered, with the flagged-for-review step. Two reasons from the docs:

- Q-1's validator already gates every generated question, and C-08 rules out a human gate on everyday questions. A daily set made only of validated questions carries the same risk as a sprint, which runs with no human gate today.
- Adding the auto-published questions to Q-2's "everything flagged" list keeps the part of Q-2 that still applies: the owner still looks at each one, after the fact.

If spot checks of auto-published sets start finding wrong questions, B is the narrower fallback and lives in the same job.

Accepted by the owner on 2026-11-01: option A, with the flagged-for-review step. The owner's answers to the open questions are below.

## Consequences

If A is accepted:

- **P3-W13-S05 is unblocked.** It builds:
  - a worker job that picks tomorrow's set and queues it for review;
  - `/admin/daily` to approve the set and swap questions;
  - auto-publish at 00:00 UTC with a banner on `/admin/daily`, a log line and a metric;
  - the questions of an auto-published set added to the spot-check list.
- **Q-2's "reviewed the day before"** becomes "offered for review the day before; published unreviewed if not approved by the day's start". docs/decisions.md isn't edited by this ADR; the owner records it.
- **§6.8's hand-written questions** still serve the challenge when the owner adds or swaps them in. They are not retired after use (below).

## Open questions

- **How is the owner told?** Answer (owner, 2026-11-01): a banner on `/admin/daily` only, no email.
- **Is a hand-written question retired after a challenge uses it?** Answer (owner, 2026-11-01): no. It stays in the bank for rounds and sprints. This departs from §6.8's "retired after use"; docs/product.md isn't edited by this ADR, and the owner records it.
- **When is tomorrow's set picked?** Still open. Suggested: at 00:00 UTC, for the following day, which gives the owner a full day to review. The S05 plan will use this unless the owner says otherwise.
