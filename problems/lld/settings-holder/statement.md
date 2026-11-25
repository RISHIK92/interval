# Process-wide settings

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service keeps one settings object for the whole process. Loading it is expensive, so it
is loaded the first time something reads a setting, and never again until someone asks
for a reload. Operators can override single settings at runtime, on top of what was
loaded.

- `SettingsHolder(defaults)`: a holder whose settings, once loaded, are exactly
  `defaults` (key to value). Creating the holder loads nothing.
- `value(key)`: the key's override if it has one, otherwise its loaded value, or null when
  it has neither. If the settings aren't loaded, this call loads them first.
- `loads()`: how many times the settings have been loaded. It never loads them itself.
- `overrideKey(key, value)`: from now on `value(key)` answers `value`, replacing any
  earlier override of the key. The key needn't be in `defaults`. Overriding doesn't load
  the settings, and an override made before the first load still applies after it.
- `reload()`: forgets the loaded settings and every override. Nothing is loaded until the
  next call that needs the settings, so two reloads in a row cost no load at all.

An empty key or value fails in every call, including in `defaults`. A call that fails
changes nothing, and a `value` call that fails loads nothing. Keys and values are
printable ASCII and case-sensitive, `defaults` has at most 100 entries, and there are at
most 10^4 calls.
