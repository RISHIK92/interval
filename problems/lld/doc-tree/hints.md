> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If objects, arrays and scalars all answered "your child at this segment", "your summary", "how many nodes below you" and "your leaves' paths", how much of the tree class would still need to know which kind it's holding?

## Approach

Parse a path into segments first (split on `.`, then each part on `[`), so every operation works on a list of keys and indexes. Give the three node kinds one interface, with `child(segment)` returning nothing for a missing child or a segment of the wrong kind, and let branches answer `size` and `leaves` by recursing into their children. Then one walk that follows the segments as far as they exist serves every method: `read`, `count` and `paths` need the walk to reach the end. A `put` whose walk stops early checks the whole missing tail before creating anything: the first missing segment must fit the last existing node, and later indexes all land in new, empty arrays.

## Code sketch

```text
parse(path) -> list of segments     // TODO: key | index; fail on bad syntax

interface Node                      // Scalar, ObjectNode, ArrayNode
  child(segment) -> Node or none
  summary() -> string
  size() -> int                     // nodes below
  leaves(at) -> list of paths
interface Branch extends Node
  room(segment) -> bool             // TODO: can a new child go here?
  attach(segment, node); detach(segment)

class DocTree
  root = ObjectNode()
  walk(segments) -> (last node reached, segments left)
  put(path, val) -> bool
    // TODO: walk; replace a scalar, refuse a branch
    // TODO: else check the whole missing tail, then grow it
  read, remove, paths, count        // TODO: all start with walk
```
