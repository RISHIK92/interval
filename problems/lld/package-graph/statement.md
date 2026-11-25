# Package dependencies

> PROVISIONAL (LLD practice batch A3, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the dependency graph of a package registry. A package declares the packages it
depends on when it is added: it uses them, but doesn't own them. A package can only depend
on packages that are already in the graph, so there are never cycles.

- `PackageGraph()`: starts with no packages.
- `add(pkg, deps)`: adds `pkg`, depending on each package in `deps` (possibly none), and
  returns true. It returns false and changes nothing when `pkg` is already in the graph,
  or when any of `deps` isn't (a package can't depend on itself). The same name twice in
  `deps` fails.
- `remove(pkg)`: removes the package and returns true. It returns false and changes
  nothing when no package has that name, or when any package depends on it.
- `dependents(pkg)`: the packages that depend on `pkg` directly, sorted in ascending order
  by character code (`"B"` before `"a"`). An unknown package fails.
- `installOrder(pkg)`: every package `pkg` needs, directly or not, then `pkg` itself, each
  once, with every package after all of its own dependencies. The order is fixed: go
  through `pkg`'s dependencies in the order they were declared, putting each one's own
  install order (without anything already listed) before moving to the next, and finish
  with `pkg`. An unknown package fails.

For example, if `app` declares `[web, db]`, `web` declares `[log]` and `db` declares
`[log, net]`, `installOrder("app")` is `[log, web, net, db, app]`.

An empty name fails in every call. A call that fails changes nothing, and failing comes first: a call that breaks one of these rules fails even when it would otherwise have returned false. Names are printable ASCII and case-sensitive. There are at most 500 packages, at most 100 dependencies in one `add`,
and at most 10^4 calls.
