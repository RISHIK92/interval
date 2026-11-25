> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a grant stays on the node it was attached to, what path do you walk to decide `can`, and why does that make moving a subtree almost free?

## Approach

Store the tree as nodes that know their kind, their parent and their children, and keep each node's grants on the node itself as (role, member) pairs. Inheritance is then never copied: `can` walks from the node up through its parents to the root, looking for the pair. Moving a node is just changing its parent link (and the two children sets) after the kind check; its subtree and their grants come along untouched. A table from each kind to the kind its parent must have answers every placement check, and removal is a recursive walk that counts and deletes the subtree.

## Code sketch

```text
PARENT_KIND = { folder: organization, project: folder, resource: project }

class ResourceTree
  nodes: map name -> { kind, parent, children: set, grants: set of (role, member) }

  addNode(parent, node, kind) -> bool
    // TODO: fail on empty strings or a kind not in PARENT_KIND
    // TODO: false if parent unknown, node taken, or PARENT_KIND[kind] != parent's kind
  attach(node, role, member)
    // TODO: fail if node unknown; add (role, member) to its grants
  can(member, role, node) -> bool
    // TODO: walk node -> parent -> ... -> root, looking for the pair
  move(node, parent) -> bool
    // TODO: false if unknown, the organization, or the kind doesn't fit
    // TODO: relink parent and children; grants stay on their nodes
  remove(node) -> int
    // TODO: fail if unknown or the organization
    // TODO: unlink from its parent; drop it and its subtree, counting
```
