# Pager adapter

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The incident API names teams and uses three severities, `sev1` (worst) to `sev3`. The
legacy pager it has to drive knows teams only by numeric code and uses levels from 1
(worst) to 5. Build the adapter that translates both ways: pages go out as legacy lines,
and the pager's acknowledgements come back in the API's words.

| Severity | Level sent | Levels read back as it |
| -------- | ---------- | ---------------------- |
| `sev1`   | `1`        | `1`, `2`               |
| `sev2`   | `3`        | `3`                    |
| `sev3`   | `5`        | `4`, `5`               |

Numbers in legacy lines are written in decimal without leading zeros, and an
acknowledgement's numbers are matched exactly as written: `"07"` is not 7.

- `PagerAdapter(teamCodes)`: each team name with its code. A code outside 1 to 9999, an
  empty name, or two teams with the same code fails. The map may be empty.
- `page(team, severity, summary)`: pages the team and returns the line sent to the pager:
  `"PAGE <n> <code> <level> <summary>"`, where `<n>` numbers the pages sent so far, this
  one included, from 1. An unknown team, a severity not in the table (case matters) or an
  empty summary fails. The summary is sent as given, spaces and all.
- `ack(legacyLine)`: reads an acknowledgement from the pager, `"ACK <n> <code> <level>"`:
  four fields separated by single spaces, where `<level>` is the level the responder
  acknowledged at. Returns `"<team> acked page <n> at <severity>"`, the team being the one
  page `<n>` went to and the severity read back from the level. Returns null, changing
  nothing, when the line isn't four such fields starting with `ACK` (case matters), page
  `<n>` was never sent, it went to another code, it's already acknowledged, or the level
  isn't one of 1 to 5. An empty line fails.
- `pages()`: how many pages have been sent.

A call that fails changes nothing. Names, summaries and lines are printable ASCII and
case-sensitive, there are at most 100 teams, and there are at most 10^4 calls.

For example, with `{"payments": 12, "search": 7}`, `page("search", "sev3", "slow index")`
returns `"PAGE 1 7 5 slow index"`, and `ack("ACK 1 7 4")` then returns
`"search acked page 1 at sev3"`. The same acknowledgement again returns null.
