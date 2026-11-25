# Infrastructure stack builder

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An infrastructure stack is built up one piece at a time: resources, then which ones depend
on which. Common shapes come ready-made as recipes, so nobody wires a load balancer to a
service to a database by hand every time. When the stack is complete, it is checked and
turned into a creation plan that never creates something before what it depends on.

Each kind of resource needs some properties:

| Kind         | Required properties |
| ------------ | ------------------- |
| `"bucket"`   | `region`            |
| `"queue"`    | `region`            |
| `"database"` | `engine`, `size`    |
| `"service"`  | `image`, `port`     |
| `"worker"`   | `image`             |
| `"balancer"` | `port`              |

- `StackBuilder(name)`: an empty stack called `name`. An empty name fails.
- `resource(kind, name, props)`: adds a resource of that kind with those properties and
  returns true. A name already in the stack is refused: false, and nothing changes. A kind
  not in the table (case matters), an empty name, or an empty property name or value,
  fails, even when the name is also taken. Properties
  may be missing (validation reports them) or extra (they are kept and ignored).
- `dependsOn(a, b)`: records that resource `a` depends on resource `b`, so `b` must be
  created first, and returns true. It's refused (false) when `a` already depends on `b`,
  and when `b` already depends on `a`, directly or through other resources, since that
  would make a cycle. An unknown resource, or `a` equal to `b`, fails.
- `preset(recipe, name)`: adds a recipe's resources and dependencies, named after `name`,
  and returns how many resources it added. If any of those names is already in the stack,
  it adds nothing and returns 0. An unknown recipe (case matters) or an empty name fails.

| Recipe     | Resources                                                                                                                                                                                        | Dependencies                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `"web"`    | `<name>-lb`, a balancer with `port` `"443"`; `<name>-app`, a service with `image` `"<name>:latest"` and `port` `"8080"`; `<name>-db`, a database with `engine` `"postgres"` and `size` `"small"` | `<name>-lb` depends on `<name>-app`, which depends on `<name>-db` |
| `"worker"` | `<name>-jobs`, a queue with `region` `"us-east-1"`; `<name>-worker`, a worker with `image` `"<name>:latest"`                                                                                     | `<name>-worker` depends on `<name>-jobs`                          |

- `validate()`: one entry, `"<resource>: missing <property>"`, for each required property
  a resource doesn't have, sorted by character code. Empty when nothing is missing.
- `plan()`: every resource, each written as `"<kind> <stack>/<resource>"`, in an order
  that creates each one only after everything it depends on. Among the resources that
  could come next, the one whose name is smallest by character code goes first. A stack
  whose `validate()` isn't empty fails.

A call that fails changes nothing. Names, kinds and properties are printable ASCII and
case-sensitive, a stack holds at most 1,000 resources, and there are at most 10^4 calls.

For example, in a stack called `"shop"`, `preset("web", "store")` returns 3. After adding
a bucket `"assets"` with a `region` and making `"store-app"` depend on it, `plan()`
returns `["bucket shop/assets", "database shop/store-db", "service shop/store-app",
"balancer shop/store-lb"]`.
