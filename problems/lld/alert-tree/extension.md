# Alert rule groups: moving nodes (extension round)

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Teams reorganise, and the alerts follow them.

- `moveNode(node, parent)`: moves the node at `node`, with everything under it, into the
  group at `parent`, and returns true. Its name and every muted flag under it are kept, so
  its path and the paths of everything under it change.
  - It is refused (false) when `parent` is the node itself or anywhere under it, and when
    `parent` already has a child with the node's name, which includes moving a node into
    the group it is already in.
  - It fails when either path is unknown, when `parent` is a rule's path, and when `node`
    is the root, `"/"`.
- Failing comes before refusing: `moveNode("/r", "/r")` on a rule fails.
- A moved node is silenced by the mutes of its new groups, and no longer by the old ones.
