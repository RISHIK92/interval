# Dependency injection container: decorators (extension round)

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Caching, metrics and logging get layered around services without the services knowing.

- `decorate(service, wrapper)`: every instance of `service` built from now on is wrapped:
  its text becomes `"<wrapper>[<instance>]"`. A service decorated more than once has the
  latest wrapper outermost, for example `"metrics[cache[repo#3(db#1)]]"`. The wrapper is
  part of the instance's text wherever it's injected.
  - Instances built before the call keep their text, so an existing singleton or scoped
    instance comes back unwrapped. Wrapping doesn't change the count of instances.
  - An unknown service, or an empty wrapper, fails.
