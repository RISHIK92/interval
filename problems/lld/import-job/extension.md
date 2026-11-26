# Import jobs: dropping duplicates (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Upstream systems resend data, and the same rows arrive again and again.

- `dedupe(on)`: switches an optional skeleton step on or off for the runs that follow.
  While it's on, after a line passes validation and before it is loaded, the line is
  dropped when its record was already loaded by this job, in this run or any earlier
  one, whether dedupe was on then or not.
  - For `users`, records match when their emails match, ignoring case.
  - For `events`, records match when the whole loaded record matches.
  - A dropped line is neither loaded nor rejected. While dedupe is on, `runImport`'s map
    has a fourth key, `"duplicates"`: how many lines this run dropped. With it off, the
    map has its three keys again.
