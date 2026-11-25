> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What does the loader need to remember about a secret so that it can tell, at the moment of a reveal, whether a trip to the vault is needed?

## Approach

Model the vault as its own small object: it knows each secret's current version, counts its round trips and builds values. The loader keeps a cache from name to value and nothing else. A reveal looks in the cache first and goes to the vault only on a miss; a rotation tells the vault to move to the next version and evicts the name from the cache, so the miss happens lazily on the next reveal rather than straight away. Check that the name is known before you touch the cache or the vault, so a failing call costs nothing.

## Code sketch

```text
class Vault
  versions: map name -> int
  trips: int
  fetch(name) -> string
    // TODO: trips += 1; value from its version
  rotate(name)
    // TODO: next version

class SecretLoader
  vault, cache: map name -> value

  constructor(names)
    // TODO: fail on empty or repeated names
  reveal(name) -> string
    // TODO: fail if unknown
    // TODO: on a cache miss, fetch it into the cache
  fetches() -> int
  rotate(name)
    // TODO: fail if unknown; vault.rotate; evict
```
