# Lazy secret loader: prefetching (extension round)

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

At startup the service knows which secrets it will need, and one round trip for all of
them is cheaper than one each.

- `prefetch(names)`: fetches every listed secret the loader doesn't have, all in one vault
  fetch, and returns how many secrets that fetch brought. A name listed twice counts once.
  When the loader already has every listed secret (or the list is empty) it makes no fetch
  and returns 0.
- A prefetched secret is like a revealed one: revealing it costs no fetch until it is
  rotated.
- An empty or unknown name anywhere in the list fails, and then nothing is fetched.
