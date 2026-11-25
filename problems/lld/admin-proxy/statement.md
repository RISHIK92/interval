# Protected admin API

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An internal admin API can suspend, restore and delete accounts, and it does whatever it is
asked. Callers never reach it directly: an access proxy stands in front of it with the
same call, checks the caller's roles, and writes every attempt to an audit log. The API
counts the calls that actually reach it, so a denied call provably never got there.

Roles are granted to users, and a user may hold several. A user is allowed an action when
any of their roles allows it:

| Role         | Actions it allows                      |
| ------------ | -------------------------------------- |
| `"viewer"`   | `read`                                 |
| `"operator"` | `read`, `suspend`, `restore`           |
| `"admin"`    | `read`, `suspend`, `restore`, `delete` |

The API keeps its own accounts (the targets), separate from the users the proxy knows: a
target can be any name, and deleting one never changes anyone's roles. Every target starts
active.

| Action      | What the API does, and its status                                 |
| ----------- | ----------------------------------------------------------------- |
| `"read"`    | `200`                                                             |
| `"suspend"` | `200` and the target is suspended; `409` if it already is         |
| `"restore"` | `200` and the target is active again; `409` if it isn't suspended |
| `"delete"`  | `200` and the target is deleted                                   |

Whatever the action, a target that has been deleted gets `404` and nothing changes.

- `AdminProxy()`: a proxy with no grants, an empty audit, and an API with no calls.
- `grant(user, role)`: gives `user` the role. Granting a role the user already holds
  changes nothing. An empty user, or a role not in the table (case matters), fails.
- `invoke(user, action, target)`: returns `"<status> <action> <target>"`, for example
  `"403 delete bob"`. The status is:
  - `401` when `user` has never been granted a role (the proxy doesn't know who it is);
  - otherwise `403` when none of the user's roles allows the action;
  - otherwise the API's status, and the call counts as reaching the API.

  Every invoke that doesn't fail adds `"<user> <action> <target> <status>"` to the audit,
  whatever its status. An empty user or target, or an action not in the table (case
  matters), fails, even for a user the proxy doesn't know.

- `audit()`: every audit line, oldest first.
- `realCalls()`: how many invokes reached the API.

A call that fails changes nothing: it isn't audited and never reaches the API. Users,
targets, roles and actions are printable ASCII (spaces allowed) and case-sensitive, and
there are at most 10^4 calls.

For example, with `"ana"` an operator, `invoke("ana", "suspend", "bob")` returns
`"200 suspend bob"`, a second one returns `"409 suspend bob"`, and
`invoke("ana", "delete", "bob")` returns `"403 delete bob"` without reaching the API, so
`realCalls()` is 2.
