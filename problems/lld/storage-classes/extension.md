# Storage classes: lifecycle moves (extension round)

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Finance wants old objects moved to cheaper classes, and sometimes back again.

- `transition(key, storageClass)`: moves the key's object to another class, keeping its
  data, and returns true. It returns false, changing nothing, when the bucket doesn't hold
  the key or the object is already in that class. An empty key, or an unknown class, fails.
- Moving an archive object out of archive needs it restored first: if it hasn't been
  restored, the move counts one restore and charges the restore fee. A move itself is
  otherwise free and charges no read fee.
- After a move the object starts fresh in its new class: one moved into archive hasn't been
  restored, even if it was restored there before.
