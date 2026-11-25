# Deploy facade

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Shipping a service means driving five tools in order: the builder, the image registry, the
database migrator, the cluster and the chat bot. Build the facade in front of them: one
`deploy` call runs them all, undoes what already ran when one fails, and keeps each
service's history of live versions.

The steps, always in this order, are `build`, `push`, `migrate`, `rollout` and `announce`.
A release is written `<service>@<version>`. A step that runs writes `"<step> <release>"`.

- `DeployFacade()`: no history, nothing broken.
- `deploy(service, version)`: runs the steps in order and returns the lines written, then
  adds the version to the end of the service's history. When a step is broken:
  - it writes `"<step> <release> failed"` instead, and the steps after it don't run;
  - then each step that already ran is undone, the most recent first, writing
    `"undo <step> <release>"`;
  - the history doesn't change, and the step is no longer broken.

  The live version is the last one in the history. Deploying the live version again is a
  full run, and adds it again. An empty service or version fails.

- `breakStep(step)`: makes the step fail the next time a deploy reaches it, once. Breaking
  a step that's already broken changes nothing. A step not in the list fails (case
  matters).
- `history(service)`: the service's versions, oldest first, the live one last. A service
  never deployed has `[]`. An empty service fails.
- `rollback(service)`: removes the live version from the end of the history and returns the
  version that's live now. It runs no step, so a broken step stays broken. When the
  history has fewer than two versions it returns null and changes nothing. An empty
  service fails.

A call that fails changes nothing. Services and versions are printable ASCII and
case-sensitive, and there are at most 10^4 calls.

For example, after `deploy("api", "1.0")` and `breakStep("migrate")`, `deploy("api", "1.1")`
returns `["build api@1.1", "push api@1.1", "migrate api@1.1 failed", "undo push api@1.1",
"undo build api@1.1"]`, and `history("api")` is still `["1.0"]`.
