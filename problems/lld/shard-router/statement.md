# Shard routing

> PROVISIONAL (LLD practice batch 8c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A sharded database needs to know which shard holds each key. There are three ways to
decide, and the router is built with one of them. Shards are numbered from `0` to
`shards - 1`.

- `"hash"`: the key's hash modulo the shard count. The hash is computed over the key's
  characters in order: start with `h = 0`, and for each character
  `h = (h * 31 + code) mod 1000000007`, where `code` is its character code. The shard is
  `h mod shards`.
- `"range"`: printable ASCII (codes 32 to 126) is cut into equal ranges by the key's
  first character: the shard is `floor((code - 32) * shards / 95)`, where `code` is the
  first character's code.
- `"directory"`: an explicit table from key to shard, filled by `assignDirectory`. A key
  with no entry has no shard.

The router also tracks keys, so it can say how many of them a change would move.

- `ShardRouter(shards, strategy)`: `shards` is from 1 to 1000, and `strategy` is one of
  the three, or it fails. No keys are tracked and the directory is empty.
- `route(key)`: the key's shard under the router's strategy. A key with no shard (under
  `"directory"`, one without an entry) fails.
- `track(key)`: from now on, the key is one of the tracked keys. Tracking it again
  changes nothing. A key may be tracked whether or not it has a shard.
- `assignDirectory(key, shard)`: the directory sends `key` to `shard`, replacing any
  entry it had. `shard` must be from `0` to `shards - 1`, or it fails. The directory is
  kept whatever the strategy, though only `"directory"` routes by it.
- `rebalance(shards)`: changes the shard count (from 1 to 1000, or it fails) and returns
  how many tracked keys moved: the keys whose shard after differs from their shard
  before. Having no shard counts as a value of its own: a key with no shard before and
  after didn't move. Every directory entry whose shard no longer exists moves to its old
  shard modulo the new count; the others stay.

Keys are printable ASCII and case-sensitive, and an empty one fails. A call that fails
changes nothing. A key has at most 100 characters, at most 1,000 keys are tracked, and
there are at most 10^4 calls.

For example, with 4 shards, the key `"ab"` hashes to `97 * 31 + 98 = 3105`, so `"hash"`
routes it to shard `1`, and `"range"` routes it to `floor(65 * 4 / 95) = 2`.
