# Bucket-style adapter

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An old service stores everything in one flat key-value store. New code wants an
object-storage API: buckets, keys, and listings by prefix with folder-like grouping. Build
the adapter that gives the flat store that API.

The legacy encoding is fixed and visible: the object `key` in `bucket` is stored under the
legacy key `"<bucket>:<key>"`. A bucket name can't contain `:`, so the first `:` in a
legacy key always ends the bucket; a key may contain `:`.

- `BucketAdapter()`: an empty store. Buckets aren't created: a bucket exists while it holds
  an object.
- `putObject(bucket, key, body)`: stores the body, replacing any object already at that key.
- `objectBody(bucket, key)`: the object's body, or null when there's none.
- `listObjects(bucket, prefix, delimiter)`: every key in the bucket that starts with
  `prefix`, as a list in ascending order by character code with no duplicates. An empty
  prefix matches every key. When `delimiter` isn't empty, a key that contains it after the
  prefix is listed only as its common prefix instead: the key up to and including the
  first occurrence of the delimiter that starts at or after the end of the prefix. So with
  delimiter `"/"`, the keys `2024/01/a.log` and `2024/02/c.log` list as `2024/` under the
  prefix `""`, and as `2024/01/` and `2024/02/` under the prefix `"2024/"`. A delimiter may
  be more than one character. A bucket with no objects lists `[]`.
- `legacyKeys()`: every key in the legacy store, in ascending order by character code.

An empty bucket, a bucket containing `:`, an empty key or an empty body fails, in every
method that takes one. A prefix or delimiter may be empty. A call that fails changes
nothing. All strings are printable ASCII and case-sensitive, there are at most 1000
objects, and there are at most 10^4 calls.

For example, after putting `2024/01/a.log`, `2025/x.log` and `readme` in `logs`,
`listObjects("logs", "", "/")` is `["2024/", "2025/", "readme"]` and `legacyKeys()` is
`["logs:2024/01/a.log", "logs:2025/x.log", "logs:readme"]`.
