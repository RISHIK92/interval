# Cloud resource hierarchy: deny rules (extension round)

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

- `deny(node, role, member)`: denies `role` to `member` on `node` and everything below
  it. A deny overrides every grant: `can(member, role, n)` is false for any `n` at or
  below a node with that deny, whether the grant is above the deny, at it, or below it.
  Denying it again changes nothing. An unknown node, or an empty name, role or member,
  fails.
- A deny is on its node like a grant: it moves with the node's subtree, and it goes when
  the node is removed.
- A deny is for one role and one member: other roles, and other members, are unaffected.
