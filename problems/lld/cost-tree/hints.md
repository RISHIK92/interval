> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a service and a unit both knew how to answer "what is your total?", what would a unit's answer be made of?

## Approach

Make services and units two kinds of one node, each with a name, a link to its parent unit and the same two questions: its total and its direct children. A service's total is its own cost and it has no children; a unit's total is the sum of its children's totals, asked recursively, so nothing is cached and a move needs no bookkeeping beyond relinking. Keep one map from name to node for the whole tree, so lookups and the uniqueness check are direct. Moving detaches the node from its old parent's children and attaches it to the new one, after walking up from the new parent to make sure the node isn't one of its ancestors. `top` sorts a node's children by total, then name, and takes the first `n`.

## Code sketch

```text
abstract class CostNode
  name, parent: Unit
  total() -> int
  children() -> list of CostNode

class Service extends CostNode   // has cents
  total() -> cents; children() -> empty

class Unit extends CostNode
  members: map name -> CostNode
  total()                 // TODO: sum of members' totals
  within(node) -> bool    // TODO: this or an ancestor is node

class CostTree
  nodes: map name -> CostNode
  unit(parent, name), service(parent, name, cents)
    // TODO: fail on bad input; false if the name is taken
  total(node) -> int
  move(node, parent) -> bool
    // TODO: false if same parent or parent.within(node)
    // TODO: relink parent and children
  top(node, n) -> list
    // TODO: sort by total desc, then name; first n
```
