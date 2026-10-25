---
description: Plan and implement one Phase slice by ID (for example P1-W1-S01)
argument-hint: <slice-id>
---

Slice: $ARGUMENTS

1. Read docs/progress.md.
2. Find the entry for $ARGUMENTS in docs/roadmap/phase-N-slices.md (N from the ID). If it does not exist, stop and say so.
3. Check its "Depends on" line. If a slice it depends on is not done in docs/progress.md, or an ADR it needs is not ACCEPTED in docs/adr/, stop and say which.
4. Read only the doc sections the slice cites: its decision IDs in docs/decisions.md, the cited product sections, the linked questions in docs/questions/, and any ACCEPTED ADRs it needs. Do not read whole docs.
5. Enter plan mode and present:
   - Goal (from the slice)
   - Decision IDs implemented
   - Files to create or change
   - Tests to write first, and what each one proves
   - Out of scope (from the slice, plus anything else you would be tempted to touch)
   - Risks
   - Open questions. If one blocks the slice, stop here.
6. Wait for approval. Do not write code before it.
7. After approval:
   1. Write the failing tests. Run them and show that they fail for the right reason.
   2. Implement until they pass. Stay inside the plan.
   3. Run the reviewer subagent on the uncommitted diff.
   4. Fix blockers and should-fix items. List any nit you chose not to fix, with the reason.
   5. Summarize the diff file by file: what changed and why, the decision ID it serves, and anything you are unsure of.
8. List anything you noticed outside the slice. Do not fix it.

When the slice is done and verified, commit it (author Claude, no co-author line) and push `main` (CLAUDE.md rule 4). Never force-push, deploy, or migrate a non-local database.
