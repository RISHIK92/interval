> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each tool could run a release and undo it, how little would the facade itself need to know about any of them?

## Approach

Give every tool the same two operations, run and undo, plus a flag that makes its next run fail. The facade holds the tools in their fixed order and a map from service to its list of versions. A deploy walks the tools, remembering the ones that ran; when it meets a broken one it clears the flag, writes the failure, and undoes the remembered tools from the last back to the first. A deploy that gets through every tool appends the version. Rolling back is only list work on the history: refuse below two versions, otherwise drop the last and report the new last.

## Code sketch

```text
class Subsystem
  name, broken = false
  run(release) -> "<name> <release>"
  undo(release) -> "undo <name> <release>"

class DeployFacade
  steps = [build, push, migrate, rollout, announce]
  live: map service -> list of versions

  deploy(service, version) -> list
    // TODO: fail on ""; release = service@version
    // TODO: run steps in order, remembering those that ran
    // TODO: on a broken one: clear it, "failed", undo in reverse, stop
    // TODO: all ran: append the version
  breakStep(step)       // TODO: unknown fails; set its flag
  history(service)      // TODO: fail on ""; a copy, [] if none
  rollback(service)     // TODO: fewer than 2 -> null; pop, return last
```
