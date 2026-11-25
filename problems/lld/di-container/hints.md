> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

A resolve that finds a cycle three levels down must build nothing; what would have to happen before the first instance is made?

## Approach

Hold one provider per service: its lifetime, its dependencies and its own count of instances built, which it bumps whenever it builds one. Lifetimes then differ only in where a finished instance is kept: a map for the whole container, a map per scope, or nowhere. Resolving is two passes. First walk the dependency graph from the requested service, failing on an unknown name, on a service already on the current path, or on a scoped service reached from below a singleton. Only then build depth first, asking each dependency's keeper for an existing instance before building a new one. Ending a scope drops that scope's map.

## Code sketch

```text
class Provider
  service, lifetime, deps, made = 0
  build(depInstances) -> string
    // TODO: made += 1; "<service>#<made>" + "(deps)" if any

class DiContainer
  providers: map service -> Provider
  singletons: map service -> instance
  scopes: map scope -> (map service -> instance)

  provide(service, lifetime, deps)   // TODO: check
  resolve(service, scope) -> string
    // TODO: check(service, inSingleton = false, path)
    // TODO: then instance(service, scope)
  check(service, inSingleton, path)
    // TODO: unknown, on path, or scoped below a singleton
  instance(service, scope) -> string
    // TODO: pick the keeper by lifetime; reuse if kept
    // TODO: else build from deps' instances, keep it
  constructed(service) -> int
  endScope(scope) -> int
```
