# Cloud resource hierarchy

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a cloud's resource hierarchy and its access checks. The hierarchy is a tree of
nodes, each with a unique name and a kind. Each node holds its children: removing a node
removes everything under it. Members are only named in role grants, never stored as
nodes.

The kind rules decide what can go where:

| Kind             | Its parent must be |
| ---------------- | ------------------ |
| `"organization"` | none: the root     |
| `"folder"`       | the organization   |
| `"project"`      | a folder           |
| `"resource"`     | a project          |

A role granted to a member on a node is inherited by everything below it: the member has
that role on the node and on every node in its subtree, wherever the subtree is.

- `ResourceTree(org)`: a tree holding only the organization node `org`.
- `addNode(parent, node, kind)`: adds `node`, of kind `kind`, as a child of `parent`, and
  returns true. It returns false and changes nothing when `parent` isn't in the tree,
  `node` is already a name in the tree, or the kind rules don't allow `kind` under
  `parent`. A kind other than `"folder"`, `"project"` or `"resource"` fails.
- `attach(node, role, member)`: grants `role` to `member` on `node`. Granting it again
  changes nothing. An unknown node fails.
- `can(member, role, node)`: whether `member` has `role` on `node`: granted on `node`
  itself or on any node above it. Roles are separate: one role never implies another. An
  unknown node fails.
- `move(node, parent)`: `node` and its whole subtree, with every grant on them, become a
  child of `parent`, and the call returns true. What they inherit now comes from their new
  ancestors. It returns false and changes nothing when either node isn't in the tree,
  `node` is the organization, or the kind rules don't allow `node` under `parent`. Moving
  a node to the parent it already has returns true and changes nothing.
- `remove(node)`: removes `node`, everything below it and their grants, and returns how
  many nodes went (`node` included). Their names are free again. An unknown node, or the
  organization, fails.

An empty name, kind, role or member fails in every call, the constructor included. A call that fails changes nothing, and failing comes first: a call that breaks one of these rules fails even when it would otherwise have returned false. Names, roles and members are printable ASCII and case-sensitive. There are at
most 10^4 calls.
