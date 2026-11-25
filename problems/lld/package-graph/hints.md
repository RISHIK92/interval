> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

`remove` needs to know who depends on a package, but `add` only tells you what a package depends on. How will you answer the question in the other direction without searching every package?

## Approach

Keep the dependency link in both directions: each package's declared dependencies as a list in declared order, and each package's dependents as a set. `add` refuses before changing anything, then writes both sides; `remove` refuses while the dependents set isn't empty, then unhooks the package from each of its dependencies' sets. The install order is a depth-first walk over the declared lists that emits a package after its dependencies and skips anything already emitted.

## Code sketch

```text
class PackageGraph
  deps: map pkg -> list of pkg        // declared order
  users: map pkg -> set of pkg

  add(pkg, deps) -> bool
    // TODO: fail on empty names or a repeated dep
    // TODO: false if pkg exists or any dep doesn't
    // TODO: store deps; add pkg to each dep's users
  remove(pkg) -> bool
    // TODO: false if unknown or users[pkg] is not empty
    // TODO: take pkg out of each dep's users; forget it
  dependents(pkg) -> list
    // TODO: fail if unknown; sorted users[pkg]
  installOrder(pkg) -> list
    // TODO: fail if unknown
    visit(p)
      // TODO: skip p if already listed
      // TODO: visit each of deps[p] in order, then list p
```
