> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which two lookup tables would let neither side ever learn the other's vocabulary?

## Approach

Keep the translation in data, not in branches: one table from severity to the level sent, one from level back to severity, and the team-to-code map from the constructor, checked once and kept as the text the pager sees. Paging looks both up, records the page under its number (as text) with its team and code, and formats the line. Reading an acknowledgement splits it into fields and looks each one up by its exact text; any lookup that misses means null. Keep a flag per page so a second acknowledgement is refused.

## Code sketch

```text
TO_LEVEL    = { "sev1": "1", "sev2": "3", "sev3": "5" }
TO_SEVERITY = { "1": "sev1", "2": "sev1", ... }

record Page(team, code, acked = false)

class PagerAdapter
  codes: map team -> code text
  sent: map page number text -> Page

  constructor(teamCodes)
    // TODO: fail on "", a code outside 1..9999, a shared code
  page(team, severity, summary) -> string
    // TODO: look up code and level; fail on a miss or ""
    // TODO: number = sent.size + 1; keep the Page; format the line
  ack(line) -> optional<string>
    // TODO: fail on ""; four fields, the first "ACK"
    // TODO: page by number text, its code, not acked, a known level
  pages() -> int
```
