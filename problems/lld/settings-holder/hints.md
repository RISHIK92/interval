> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every reading method checked for itself whether the settings were loaded yet, how many places would have to agree on what "load once" means, and what would a reload have to undo?

## Approach

Keep the loaded settings in one field that starts out empty, and reach it only through one private accessor: if the field is empty it loads (copies the defaults and bumps the load counter), then it returns what's there. Overrides live in their own map beside it, so overriding never needs the settings and is laid on top at read time. A reload just empties the field and the overrides; the accessor does the rest the next time someone reads. Validate a key before touching the accessor, so a call that fails costs no load.

## Code sketch

```text
class SettingsHolder
  source: map            // what a load copies
  overrides: map
  settings: map or none  // the one loaded copy
  loadCount: int

  constructor(defaults)
    // TODO: fail on an empty key or value; keep a copy
  instance() -> map
    // TODO: if none: copy source, loadCount += 1
    // TODO: return settings
  value(key) -> optional
    // TODO: fail on an empty key first
    // TODO: overrides win over instance()
  loads() -> int
  overrideKey(key, value)
    // TODO: validate; no load here
  reload()
    // TODO: forget settings and overrides
```
