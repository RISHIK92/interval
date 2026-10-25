---
description: Run the drift-auditor subagent and save its report
---

1. Run the drift-auditor subagent on the whole repository.
2. Write its report, unchanged, to `docs/audits/YYYY-MM-DD.md` using today's date. Create docs/audits/ if missing. If a report for today exists, append `-2`, `-3`, and so on.
3. Reply with the file path and the count of findings per heading.

Do not fix anything the audit finds. Do not commit.
