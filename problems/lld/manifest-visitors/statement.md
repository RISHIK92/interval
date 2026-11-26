# Manifest checks

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A deploy tool holds a set of manifests of three kinds: deployments, services and config
maps. Several operations walk the whole set (an inventory, a linter and a cost report),
and each one treats every kind differently. New operations keep arriving; the three
kinds of manifest stay the same.

Each kind has its own fields, all integers. A field marked req'd (required) must be
given, and the others may be left out:

| kind           | field        | values            | meaning                                  |
| -------------- | ------------ | ----------------- | ---------------------------------------- |
| `"deployment"` | `replicas`   | 0 to 10^6, req'd  | how many copies run                      |
|                | `cpu`        | 1 to 10^6         | the CPU limit in millicores, per replica |
|                | `memory`     | 1 to 10^6         | the memory limit in MiB, per replica     |
|                | `privileged` | 0 or 1            | 1 if it runs privileged                  |
| `"service"`    | `port`       | 1 to 65535, req'd | the port it listens on                   |
|                | `public`     | 0 or 1            | 1 if it is reachable from the internet   |
| `"configmap"`  | `entries`    | 0 to 10^6, req'd  | how many entries it holds                |
|                | `secrets`    | 0 to 10^6         | how many of them look like secrets       |

A field that is left out is 0 for `privileged`, `public` and `secrets`. A deployment
without `cpu` has no CPU limit, and one without `memory` has no memory limit.

- `ManifestSet()`: an empty set.
- `addResource(kind, name, fields)`: adds a manifest and returns `true`, or returns
  `false` if one of this kind with this name is already in the set (two kinds may share
  a name). An unknown kind, a field the kind doesn't have, a value outside its range, or
  a required field left out fails.
- `runVisitor(visitor)`: runs an operation over every manifest, in the order they were
  added, and returns its lines. An unknown operation fails.
  - `"inventory"`: one line per manifest: `"deployment/<name> replicas=<replicas>"`,
    `"service/<name> port=<port>"` or `"configmap/<name> entries=<entries>"`.
  - `"lint"`: a line for each problem found. A deployment gives
    `"deployment/<name>: single replica"` if it has exactly one replica, then
    `"deployment/<name>: no cpu limit"` if it has no CPU limit. A config map with no
    entries gives `"configmap/<name>: empty"`. Services give nothing.
  - `"cost"`: one line per manifest, `"<kind>/<name> <cost>"`, then a last line
    `"total <sum of the costs>"`. A deployment costs `replicas * (cpu + memory)`, a limit
    left out counting as 0. A public service costs 20 (its load balancer) and any other
    service 0. A config map costs 0.
- `kinds()`: the kinds that have at least one manifest in the set, sorted.

Names are printable ASCII and case-sensitive, and an empty one fails. Sorted means by
character code. A call that fails changes nothing, and a call that would both fail and
return `false` fails. There are at most 1,000 manifests and at most 10^4 calls.

For example, after `addResource("deployment", "web", {"replicas": 1, "memory": 512})`,
`runVisitor("cost")` returns `["deployment/web 512", "total 512"]`, and
`runVisitor("lint")` returns these two lines:
`"deployment/web: single replica"` and `"deployment/web: no cpu limit"`.
