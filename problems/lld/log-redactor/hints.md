> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What is the same about every rule, and what is different? Could the redactor run a rule without knowing which kind it is?

## Approach

Give every rule the same small interface: take the line's words, replace the ones it matches, and return how many it replaced. The redactor keeps rules by name, a list of enabled names in the order they were enabled, and a hit count per name; `redact` splits the line at single spaces, hands the words to each enabled rule in turn, adds up the hits, and joins the words back. The bearer rule is really "mask the word after a given word", so write it with the word and the mask as its settings.

## Code sketch

```text
interface Rule
  apply(words) -> int        // replaces in place, returns hits

Emails, Cards implement Rule
AfterWord(prefix, mask) implements Rule

class Redactor
  rules: map name -> Rule    // email, card, bearer
  enabled: list of names
  counts: map name -> int

  enable(rule)
    // TODO: fail if unknown; append unless already enabled
  disable(rule)
    // TODO: fail if unknown; remove if enabled
  redact(line) -> string
    // TODO: words = line split at every " "
    // TODO: for each enabled name: counts[name] += rule.apply(words)
    // TODO: join words with " "
  hits(rule) -> int
    // TODO: fail if unknown; counts[rule]
```
