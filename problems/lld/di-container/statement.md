# Dependency injection container

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Services name what they need instead of building it themselves, and a container builds
the whole graph on request. Each service has a lifetime that says how long an instance
lives and who shares it, and nothing is built until something asks for it.

| Lifetime      | Instances                                                            |
| ------------- | -------------------------------------------------------------------- |
| `"singleton"` | one for the whole container, built the first time it's needed        |
| `"scoped"`    | one per scope, built the first time it's needed in that scope        |
| `"transient"` | a new one every time it's needed, including each place it's injected |

- `DiContainer()`: no services.
- `provide(service, lifetime, deps)`: registers a service with a lifetime from the table
  (case matters) and the services it depends on, in order. A dependency may be provided
  later. A service already provided, an empty name, an empty dependency or a dependency
  listed twice fails, and so does a lifetime not in the table.
- `resolve(service, scope)`: returns an instance of the service for that scope, building
  what's needed: each dependency, in order, is resolved in the same scope and given to the
  new instance. An instance is written `"<service>#<n>"`, where `<n>` counts the instances
  of that service built so far, this one included. An instance with dependencies is
  followed by the instances it was given, in order, separated by `,` and wrapped in
  `(` `)`: for example `"repo#2(db#1,config#1)"`. An instance's text is fixed when it's
  built, so a kept instance comes back exactly as it was.
  - A singleton or scoped instance that already exists is reused, together with what it
    was built with.
  - It fails, building nothing, if the service or anything it depends on (directly or
    not) isn't provided, if the dependencies form a cycle, or if a singleton depends on a
    scoped service, directly or through other services: a singleton outlives any scope.
    An empty scope fails too.
- `constructed(service)`: how many instances of the service have been built. An unknown
  service fails.
- `endScope(scope)`: ends the scope: its scoped instances are disposed of, and the next
  resolve in that scope builds new ones. Returns how many it disposed of (0 for a scope
  with none). Singletons and transients are never in a scope. An empty scope fails.

A call that fails changes nothing. Names and scopes are printable ASCII and
case-sensitive, there are at most 100 services, no resolve builds more than 10^4
instances, no instance's text is longer than 10^5 characters, and there are at most 10^4 calls.

For example, with `config` a singleton, `db` scoped on `["config"]` and `repo` transient on
`["db", "config"]`, resolving `repo` in scope `"req1"` twice gives
`"repo#1(db#1(config#1),config#1)"` and then `"repo#2(db#1(config#1),config#1)"`.
Resolving it in `"req2"` gives `"repo#3(db#2(config#1),config#1)"`.
