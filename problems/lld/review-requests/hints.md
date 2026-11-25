> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What does a pull request need to remember about each person linked to it, so that it can tell an approval that counts from one that doesn't?

## Approach

Each pull request holds its author and two sets of names: who was asked and who has approved. People aren't objects of their own; the link from a person back to their pull requests is a per-reviewer list of ids in the order they were asked. `request` checks the author and the asked set before adding the link on both sides; `approve` checks the asked and approved sets, adds to approved, and takes the id out of that reviewer's list. `approvals` is the size of the approved set.

## Code sketch

```text
class ReviewQueue
  prs: map id -> { author, asked: set, approved: set }
  pending: map reviewer -> list of id   // order asked

  open(pr, author)
    // TODO: fail on empty or known id
  request(pr, reviewer) -> bool
    // TODO: fail on unknown pr
    // TODO: false for the author or someone already asked
    // TODO: add to asked; append pr to pending[reviewer]
  approve(pr, reviewer) -> bool
    // TODO: fail on unknown pr
    // TODO: false unless asked and not yet approved
    // TODO: add to approved; remove pr from pending[reviewer]
  pendingFor(reviewer) -> list
    // TODO: a copy of pending[reviewer], or []
  approvals(pr) -> int
    // TODO: fail on unknown pr; size of approved
```
