# Lazy secret loader

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A service needs a handful of secrets from a vault, but each vault round trip is slow and
billed. So a secret is fetched only the first time the service uses it, kept, and fetched
again only after the vault rotates it.

The vault numbers each secret's versions from 1, and a secret's value is its name, `#`
and its current version: `db-password#1`, then `db-password#2` after one rotation.

- `SecretLoader(names)`: a loader for the secrets the vault holds, each at version 1.
  Creating it fetches nothing. An empty or repeated name fails.
- `reveal(name)`: the secret's value. If the loader doesn't have the secret, it fetches
  it first: one vault fetch, which brings the secret's current value. Otherwise it answers
  from what it has, with no fetch.
- `fetches()`: how many vault fetches have been made.
- `rotate(name)`: the vault moves the secret to its next version, and the loader drops
  the value it had, so the next `reveal` fetches again. Rotating fetches nothing, and
  rotating several times before a reveal still costs only that one fetch.

A name the vault doesn't hold, or an empty name, fails in every call. A call that fails
changes nothing and fetches nothing. Names are printable ASCII and case-sensitive, there
are at most 100 of them, and there are at most 10^4 calls.
