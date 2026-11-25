# Cost allocation tree: shared costs (extension round)

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some costs belong to no single service: the support contract, the shared VPN. Finance
splits each one evenly among the nodes directly under a unit.

- `sharedCost(node, cents)`: splits `cents` among the nodes directly under the unit `node`,
  as they are now. With `k` of them, each gets `cents / k` rounded down, and the remainder
  goes one cent each to the first nodes in character-code order of their names. So 10
  cents among `"a"`, `"b"` and `"c"` gives 4, 3 and 3.
- A node's share is added to its own total, and to the totals of every unit above it. It
  belongs to that node: it moves when the node moves, and it isn't split further among
  what's under the node. A node can receive any number of shares.
- Nodes added later get nothing from earlier shares.
- It fails when `node` is unknown, is a service, or has nothing directly under it, and when
  `cents` is negative. Sharing 0 cents changes nothing,
  and `cents` is at most 10^9.
