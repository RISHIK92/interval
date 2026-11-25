# Cost allocation tree

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Finance wants the monthly cloud bill broken down the way the company is organised. Org
units contain other units (departments contain teams, teams contain sub-teams), and units
contain services, each with its own monthly cost in cents. A unit's total rolls up
everything under it. Services and units answer the same question, "what is your total?",
so a report never needs to know which one it is looking at.

The tree starts with one unit, the root. Every node, unit or service, has a name that is
unique in the whole tree.

- `CostTree(root)`: a tree whose only node is the unit `root`. An empty name fails.
- `unit(parent, name)`: adds an empty unit called `name` under the unit `parent`, and
  returns true.
- `service(parent, name, cents)`: adds a service costing `cents` under the unit `parent`,
  and returns true.
- Both are refused (false) when `name` is already a node anywhere in the tree. Both fail
  when `parent` isn't a node or is a service (a service has nothing under it), or when
  `name` is empty; `service` also fails when `cents` is negative.
- `total(node)`: a service's cost, or for a unit the sum of the totals of everything
  directly under it (0 for an empty unit). An unknown node fails.
- `move(node, parent)`: moves the node, with everything under it, under the unit
  `parent`, and returns true. Its costs leave the totals of its old units and join those
  of its new ones. It is refused (false) when `parent` is already the node's parent, and
  when `parent` is the node itself or anywhere under it. It fails when either is unknown,
  when `parent` is a service, and when `node` is the root.
- `top(node, n)`: the nodes directly under `node`, written `"<name> <total>"`, highest
  total first, ties broken by name in character-code order, and at most `n` of them. A
  service has nothing under it, so it gives an empty list. A negative `n`, or an unknown
  node, fails.

Failing comes before refusing in every call: `move("r", "r")` on the root fails. A call that
fails changes nothing. Names are printable ASCII (spaces allowed) and
case-sensitive. A service costs at most 10^9 cents, `n` is at most 1,000, a tree has at most 1,000 nodes and is
at most 100 units deep, and there are at most 10^4 calls.

For example, under `"acme"`, if the unit `"eng"` holds `"payments"` (services costing
120000 and 45000) and `"search"` (one costing 80000), and the unit `"sales"` holds a service
costing 30000, then `total("eng")` is 245000 and `top("acme", 5)` returns
`["eng 245000", "sales 30000"]`. After `move("search", "sales")`, `top("acme", 2)` returns
`["eng 165000", "sales 110000"]`.
