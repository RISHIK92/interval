Source: docs/_source/interval-blueprint-2026-10-23.md, Part III, lines 565–607. Copied verbatim below the dependency list. Export escaping (`\*`, `\~`) is unescaped so Markdown renders (owner-approved 2026-10-25). No words changed.

Depends on decisions (derived, verify): ARCH-1, ARCH-2, ARCH-4, DB-1, DB-2, DB-3, DB-5, DB-6, CACHE-1, LOAD-1, LOAD-3, LOAD-5, LOAD-6, ING-1, ING-2, ING-3, ING-4, ING-6, PER-1, PER-3, REC-1, REC-2, REC-3, REC-5, AI-1, AI-2, AI-3, AI-4, OPS-1, OPS-2, OPS-3, OPS-4

---

## Phase 1 — Learning feed (weeks 1–6)  
  
**Stack:** Next.js full-stack app and a Python worker, with RDS (pgvector), S3, SQS, EventBridge, Firehose, and managed auth. No Redis yet.  
  
**Week 1:**  
- CDK, RDS, S3, SQS, CI/CD  
- the Next.js shell and auth  
- guest sessions that merge into accounts on sign-up  
- invite codes for the two beta groups  
- event tracking, the entitlements layer, and cost budgets  
  
**Week 2:**  
- 50 to 100 seed sources  
- scheduled polling and extraction that keeps headings  
- canonical URLs, duplicate detection, rights flags  
  
**Week 3:**  
- the ~250-concept graph, LLM tagging, difficulty estimates  
- moment segmentation and embeddings per moment  
- the admin review page  
  
**Week 4:**  
- guest-first onboarding  
- ranking that covers moments and whole articles  
- time chips and "why this matters" notes  
- feedback controls  
  
**Week 5:**  
- deep links into sections and the return prompt  
- continue cards, saves, history  
- PWA install  
  
**Week 6:**  
- daily personal use and ranking tuning  
- a script that checks deep links land on the right section  
- Athena queries split by beta group  
- private beta with about 30 students and 30 working developers  
  
**Not in Phase 1:** notes, paths, quizzes, games, audio, GitHub, native apps.  
  
**Done when:**  
- at least 40% of users return the week after signing up  
- at least half of opened items get marked finished  
