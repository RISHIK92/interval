> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If an environment simply kept a reference to its template's variables, what would happen to every environment forked from it the first time one of them called `setVar`?

## Approach

Make the template an object that knows how to copy itself, and have every copy own fresh containers: a new map of variables, never a shared one. Keep templates and environments in two registries keyed by name. Forking finds the template, checks whether the environment name is taken, and stores the template's copy. Redefining a template just puts a new object in the registry, so environments made from the old one are untouched. Because each environment owns its map, `setVar` can compare and write in place.

## Code sketch

```text
class Environment             // the prototype
  variables: map key -> value
  copy() -> Environment
    // TODO: a new Environment over a new map

class EnvTemplates
  templates: map name -> Environment
  envs: map name -> Environment

  define(name, vars)
    // TODO: validate; store a new Environment(vars)
  fork(base, env) -> bool
    // TODO: fail on empty env or unknown base
    // TODO: false if env exists; else envs[env] = copy
  setVar(env, key, value) -> bool
    // TODO: fail on unknown env, then empty key or value
    // TODO: false if unchanged; else write
  vars(env) -> map
    // TODO: a copy, so callers can't reach inside
```
