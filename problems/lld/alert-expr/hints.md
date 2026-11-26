> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each piece of the grammar became its own kind of tree node, which node would be the only one that ever needs to look a metric up?

## Approach

Parse once into a tree of small node classes: a comparison holding a metric, an operator and an integer; a not holding one child; and an and or an or holding two. Every node answers the same questions recursively: its value for some metrics, its depth, and the metric names under it. A comparison is the only node that touches the metrics, so it is also the only one that counts itself as evaluated, and the and and or nodes get short-circuiting for free by only asking their right child when they need to. The parser is recursive descent with one method per grammar line: a loop that keeps folding `or` (or `and`) into a left-leaning node, and a method for the tightest level that handles `not`, brackets and a comparison. A tokenizer turns the text into numbers, words and symbols first, so the parser only checks token kinds, and finishing with tokens left over is an error.

## Code sketch

```text
interface Node
  evaluate(metrics, tally) -> bool
  depth() -> int
  names(out)

class Compare(metric, op, value)       // TODO: count, absent is false
class Not(inner)                       // TODO
class And(left, right), Or(left, right) // TODO: short-circuit

class Parser
  tokens, pos
  expression()     // TODO: conjunction ("or" conjunction)*
  conjunction()    // TODO: negation ("and" negation)*
  negation()       // TODO: "not", "(" expression ")", or NAME OP INT
  take(text) -> bool, expect(kind) -> token   // TODO

class AlertExpr
  tree, tally
  constructor(expression)  // TODO: parse; tokens left over fail
  evaluate(metrics) -> bool
  variables() -> list      // TODO: sorted, distinct
  depth(), evaluations()
```
