# Infra state snapshots: pruning (extension round)

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Snapshots of a large estate take room, and nobody restores last month's state. Operators
keep only the newest few.

- `prune(keep)`: deletes every snapshot except the `keep` newest ones (the ones with the
  highest ids) and returns how many it deleted. With `keep` snapshots or fewer, it
  deletes nothing and returns `0`. A negative `keep` fails.
  - A deleted snapshot is gone like any other: `restore` returns `false` for its id and
    `diffSince` fails, and its label is free again.
  - The current state isn't touched, and ids still never repeat.
