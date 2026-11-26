> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every operation had to handle all three kinds, where would you put the code for "the cost of a service" so that adding a fourth operation never meant opening the service class?

## Approach

Give each kind its own small class holding its parsed fields, and one method, accept, that hands itself to a visitor by calling the visitor's method for that kind. Each operation is then a visitor class with one method per kind, collecting lines as it goes, plus a last step that returns them (the cost visitor adds its total there). The set keeps the manifests in a list in the order added and a set of (kind, name) pairs for duplicates; running a visitor walks the list calling accept. Validation is table-driven: per kind, each field's range and whether it is required, checked before anything is stored.

## Code sketch

```text
class Deployment / Service / ConfigMap
  name, parsed fields
  accept(visitor)     // TODO: visitor.deployment(this), and so on

interface Visitor
  deployment(d), service(s), configmap(c)
  finish() -> list of lines

class Inventory, Lint, Cost implements Visitor   // TODO: one per operation

class ManifestSet
  items: list in the order added
  names: set of (kind, name)

  addResource(kind, name, fields) -> bool
    // TODO: validate kind, name, each field's range, required fields
    // TODO: false on a duplicate, else build and append
  runVisitor(visitor) -> list
    // TODO: pick the visitor, every item accepts it, finish
  kinds() -> list                                 // TODO: sorted
```
