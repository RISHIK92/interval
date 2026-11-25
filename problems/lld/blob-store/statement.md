# Swappable blob store

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a blob store with two backends behind one interface: `"plain"`, which keeps only the
latest blob of each key, and `"versioned"`, which keeps every blob a key has had. Callers
never care which one is in use: every call below answers the same with either backend.

- `BlobStore(backend)`: an empty store on `"plain"` or `"versioned"`. Any other backend
  (case matters) fails.
- `putBlob(key, data)`: stores `data` as the key's latest blob and returns its version: 1
  for a key the store doesn't hold, then one more for each later put. `data` may be empty
  and is kept exactly as given.
- `fetch(key)`: the key's latest blob, or null when the store doesn't hold the key.
- `remove(key)`: removes the key, with all its versions, and returns true; false when the
  store doesn't hold it. Putting the key again starts at version 1.
- `listKeys(prefix)`: the keys that start with `prefix`, sorted in ascending order by
  character code (`"B"` before `"a"`). An empty prefix lists every key.
- `migrate(backend)`: moves the store to the other backend and returns the number of keys
  it moved. Each key's latest blob is put into the new backend once, so every key is at
  version 1 there and its older versions are gone. Migrating to the backend already in use,
  or to an unknown one, fails.

An empty key fails in every call. A call that fails changes nothing. Keys and data are
printable ASCII and case-sensitive; data is at most 1000 characters, and there are at most
10^4 calls.
