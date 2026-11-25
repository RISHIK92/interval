# Storage classes

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a bucket whose objects can each live in one of three storage classes. The classes
cost different amounts, but every one keeps the same promise: what you store is what you
read back. Archive objects are slow to reach, so reading one may cost a restore, but a
read never fails or answers null because of the class.

- `StorageBucket()`: an empty bucket.
- `store(key, data, storageClass)`: stores `data` under `key` in that class, replacing
  any object the key had (the new object hasn't been restored). The class is
  `"standard"`, `"infrequent-access"` or `"archive"`; any other fails. `data` may be
  empty.
- `read(key)`: the key's data exactly as stored, or null when the bucket doesn't hold the
  key. Reading an archive object that hasn't been restored restores it first: that counts
  as one restore and charges the restore fee. It then stays restored until the key is
  stored again, so later reads cost nothing.
- `restores()`: the number of restores so far.
- `monthlyCost()`: what keeping the bucket's current objects costs for a month, plus every
  fee charged so far (fees stay charged after the object is replaced).

Costs, in whole units per character of data:

| Class               | Keeping, per month | Fee                                   |
| ------------------- | ------------------ | ------------------------------------- |
| `standard`          | 4                  | none                                  |
| `infrequent-access` | 2                  | 1 on every read                       |
| `archive`           | 1                  | 3 on each restore (none on its reads) |

An empty key fails in every call. A call that fails changes nothing. Keys, data and class
names are printable ASCII and case-sensitive; keys are at most 100 characters and data at most 1000, and there
are at most 10^4 calls.
