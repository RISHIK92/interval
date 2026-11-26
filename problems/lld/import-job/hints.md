> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which steps are exactly the same for both kinds of import, and which are the only ones that differ?

## Approach

Write the skeleton once, in a base importer: a `run` method that checks for empty lines, numbers the run, then for each line splits the fields, rejects a wrong field count, asks the kind to validate, and either records the reject with its run and line number or asks the kind to transform and loads the result. Each kind is a subclass that fills in only `validate` (returning a reason or nothing) and `transform`. The public class picks the subclass from the kind and keeps it; loaded records and rejects live in the base, so both kinds count and report them the same way.

## Code sketch

```text
abstract class Importer
  loaded: list, rejects: list, runs = 0

  run(lines) -> map               // the fixed skeleton
    // TODO: fail on an empty line; runs += 1
    // TODO: for each line: split at ","
    //       3 fields? reason = validate(fields) : "fields"
    //       reason? record "<run>:<line> <reason>"
    //       else load transform(fields)
  abstract validate(fields) -> reason or none
  abstract transform(fields) -> record

class UserImporter : Importer       // TODO: email, name, age
class EventImporter : Importer      // TODO: ts, type, user

class ImportJob
  importer: chosen by kind          // TODO: fail on unknown
  runImport(lines) -> map           // TODO: delegate
```
