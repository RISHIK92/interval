> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What single question could the parser ask every format, whatever its kind, so that it never needs to know which kind it is talking to?

## Approach

Give every kind one small interface: given a line, return its fields or say it's malformed. One class per kind fills it in (key=value tokens, comma-split fields zipped with the headers, one anchored pattern for access lines), and each format object also keeps its own count. The parser maps names to format objects, in the order added; the kind string is looked at only in `addFormat`, where the object is created and the headers are checked. `parse` asks the format, fails on a malformed answer and otherwise counts it.

## Code sketch

```text
abstract class Format
  count = 0
  fields(line) -> map or nothing    // nothing: malformed

class KvFormat, CsvFormat(headers), AccessFormat extend Format
  // TODO: each reads a line its own way

class LogParser
  formats: map name -> Format, in the order added

  addFormat(name, kind, headers)
    // TODO: fail on an empty or used name
    // TODO: csv: 1-20 distinct, non-empty headers
    // TODO: kv, access: headers must be empty
    // TODO: otherwise fail (unknown kind)
  parse(format, line) -> map
    // TODO: fail on an unknown format
    // TODO: fields = format.fields(line); fail when nothing
    // TODO: format.count += 1; return fields
  parsed(format) -> int
    // TODO: fail when unknown; its count
```
