# Bucket-style adapter: copies (extension round)

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Moving objects between buckets shouldn't mean reading them out and writing them back.

- `copyObject(bucket, key, toBucket, toKey)`: copies the object's body to `toKey` in
  `toBucket`, replacing any object there, and returns true. The source is unchanged, and
  copying an object onto itself changes nothing and returns true. Returns false, changing
  nothing, when there's no object at the source. Both buckets and keys are checked as
  everywhere else, and a bad one fails, before the source is looked up.
