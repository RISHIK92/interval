---
description: Record the session in docs/progress.md and show git status
---

1. Append an entry to docs/progress.md under "## Session log" (create the heading if missing), using this shape:

   ```
   ### YYYY-MM-DD — <slice ID or "no slice">
   - Done: <what is finished and verified; name the tests that cover it>
   - Not done: <what was planned but not finished, and why>
   - Next: <the next slice ID, or the next step inside this slice>
   - Open questions: <new or still-open items; link docs/questions/ entries>
   - Surprises: <anything that differed from the docs or the plan>
   - Needs ADR: <any doc or decision that the work showed to be wrong or missing>
   ```

   Write "none" for an empty line. Report test results as they are; if tests fail, say so.
2. Update the "Status" line at the top of docs/progress.md if it changed.
3. If a new open question came up, add it to docs/questions/phase-N.md with a citation.
4. Run `git status` and show the output.

Commit and push per CLAUDE.md rule 4 only when a slice finished this session; otherwise do not commit.
