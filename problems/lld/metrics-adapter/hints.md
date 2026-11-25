> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If the new API never learns that seconds or kilobytes exist, which class has to know about them?

## Approach

Keep two parts apart. The new API is a small class that stores milliseconds and bytes by name and knows nothing about the old agent: it records a time or a size, refusing a name that already has the other kind, and reads them back. The adapter owns the old format: it splits a line into its three fields, checks the digits, looks the unit up in a table that gives its kind and its factor to the base unit, and calls the API's matching record method. Every public method of the adapter is then a thin translation onto the API.

## Code sketch

```text
TIME_UNITS = { "s": 1000, "ms": 1, "us": 0.001 }
SIZE_UNITS = { "B": 1, "KB": 1024, "MB": 1024 * 1024 }

class MetricsApi
  recordMs(name, ms) -> bool      // TODO: refuse a name that holds a size
  recordBytes(name, n) -> bool    // TODO: refuse a name that holds a time
  ms(name) / size(name) / names()

class MetricsAdapter
  api = MetricsApi()
  ingestLegacy(line) -> bool
    // TODO: fail on ""; split on " "; exactly three fields
    // TODO: value: 1..9 digits; unit in one of the tables
    // TODO: hand the converted value to the API
  gaugeMs(name)      // TODO: fail on ""; api.ms(name)
  gaugeBytes(name)   // TODO: fail on ""; api.size(name)
  names()            // api.names()
```
