> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every method of the store checked which backend is in use, how many places would change when a third backend arrives, and how would a migration swap one for the other?

## Approach

Write down the few operations the store needs from wherever blobs live (put returning a version, the latest blob, remove, the keys) as one interface, and implement it twice. The plain backend keeps each key's latest blob with a count of its puts; the versioned one keeps each key's list of blobs, whose length is the version. The store holds one backend and only talks to the interface, so validation, prefix filtering and sorting live in the store once. A migration opens a fresh backend of the other kind, puts each key's latest blob into it, and swaps it in.

## Code sketch

```text
interface Backend
  put(key, data) -> int
  latest(key) -> optional<string>
  remove(key) -> bool
  keys() -> list

class Plain implements Backend      // key -> (count, data)
class Versioned implements Backend  // key -> list of data

class BlobStore
  kind, backend

  constructor(kind)
    // TODO: fail on an unknown kind; open it
  putBlob / fetch / remove
    // TODO: fail on an empty key; ask the backend
  listKeys(prefix) -> list
    // TODO: backend.keys() filtered by prefix, sorted
  migrate(kind) -> int
    // TODO: fail if same or unknown; open the new one
    // TODO: put every key's latest blob into it; swap
```
