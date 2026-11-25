> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If one function turned a bucket and key into a legacy key, how many places in your code would know the `:` encoding?

## Approach

Leave the legacy store as it is: a flat map that can store, read and list its keys that start with a given string, in order. The adapter keeps one encoder, bucket plus `:` plus key, and turns every call into store calls through it. A listing is then a legacy scan for the encoded prefix: strip the bucket and its `:` from each legacy key, and if there's a delimiter, look for it starting at the end of the prefix and cut the key just after it. Collect into a set, since many keys share a common prefix, and sort.

## Code sketch

```text
class LegacyStore
  put(key, value) / read(key) -> optional
  scan(prefix) -> sorted keys starting with prefix

encode(bucket, key) -> "<bucket>:<key>"

class BucketAdapter
  store = LegacyStore()

  putObject(bucket, key, body)   // TODO: check all three; store.put
  objectBody(bucket, key)        // TODO: check; store.read
  listObjects(bucket, prefix, delimiter)
    // TODO: check the bucket
    // TODO: for each scanned legacy key: strip "<bucket>:"
    // TODO: find the delimiter from len(prefix); cut after it
    // TODO: a set, then sorted
  legacyKeys()                   // store.scan("")

checkBucket(bucket)   // TODO: "" or ":" fails
```
