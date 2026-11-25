# Alert rule groups

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A monitoring setup has hundreds of alert rules, organised in nested groups: everything for
the database under `/infra/db`, everything for the edge under `/edge`. During maintenance a
whole group is muted at once, and muting a group silences everything under it. Evaluating
a set of metric values returns the rules that fire. Rules and groups are treated alike:
both can be muted, counted and evaluated, and a group simply asks its children.

Every node has a **path**. The root group's path is `"/"`. A node named `n` directly under
the root has the path `"/n"`, and one under the group `"/a/b"` has the path `"/a/b/n"`. A
node is always addressed by its full path, exactly: `"/infra/"`, `"infra"` and `""` are no
node's path.

A rule watches one metric and **fires** when the metric's value is strictly greater than
its threshold. A rule is **silenced** when it, or any group above it, is muted. Muting and
unmuting set a node's own flag only: unmuting a rule inside a muted group leaves it
silenced.

- `AlertTree()`: a tree with only the root group, which isn't muted.
- `group(parent, name)`: adds an empty group called `name` inside the group at `parent` and
  returns true. If `parent` already has a child called `name`, group or rule, it's refused:
  false.
- `rule(parent, name, metric, threshold)`: adds a rule the same way, refused (false) under
  the same condition.
- Both fail when `parent` isn't a node's path or is a rule's path (a rule has no children),
  when `name` is empty or contains a `/`, and (for `rule`) when `metric` is empty, even if
  the name is also taken.
- `mute(node, on)`: sets the node's own muted flag to `on` and returns true. If it is
  already set to `on`, it's refused: false. The root can be muted too. An unknown path fails.
- `firing(metrics)`: the paths of every rule that isn't silenced, whose metric is in
  `metrics`, and whose value there is greater than its threshold, sorted by character code.
  A rule whose metric isn't in `metrics` doesn't fire.
- `count(node)`: how many rules are at or under `node`, silenced ones included: 1 for a
  rule, and the sum over its children for a group. An unknown path fails.

A call that fails changes nothing. Names and metrics are printable ASCII (spaces allowed)
and case-sensitive. Thresholds and values are integers whose absolute value is below
2^53. There are at most 10^4 calls, a tree has at most 1,000 nodes, and it is at most 50
groups deep.

For example, with rules `/infra/db/cpu-high` (`db.cpu` above 90) and `/infra/net-errors`
(`net.err` above 10), `firing({"db.cpu": 97, "net.err": 11})` returns both paths. After
`mute("/infra/db", true)` it returns only `["/infra/net-errors"]`, and `count("/infra")` is
still 2.
