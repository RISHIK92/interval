> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a group answered "which of your rules fire?" by asking each of its children the same question, what would a muted group have to do to silence all of them?

## Approach

Give rules and groups one shared node type with a name, a parent link, a muted flag and the same operations: collect the rules that fire, and count rules. A rule answers for itself: it fires when it isn't muted and its metric is present and above the threshold, and it counts as one. A group keeps its children in a map by name; it returns nothing when it is muted, and otherwise passes the question to every child, so a mute anywhere above a rule silences it without any rule having to look upwards. Paths are built from parent links, and looking one up is a walk from the root, one name at a time, failing on a missing child or a rule in the middle. The tree class only validates, finds nodes and sorts the collected paths.

## Code sketch

```text
abstract class Node
  name, parent: Group, muted
  path() -> string        // TODO: from the parent's path
  firing(metrics, out)    // collects firing rule paths
  count() -> int

class Rule extends Node
  metric, threshold
  firing(metrics, out)    // TODO: unmuted, present, above
  count() -> 1

class Group extends Node
  children: map name -> Node
  firing(metrics, out)    // TODO: nothing if muted; else ask each
  count()                 // TODO: sum over children

class AlertTree
  root: Group
  group(parent, name), rule(...)
    // TODO: find the parent group, check, false if taken
  mute(node, on)          // TODO: false if already on
  firing(metrics)         // TODO: root.firing, sorted
  find(path) -> Node      // TODO: walk names from the root
```
