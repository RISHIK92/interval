# Test environment kit: new families (extension round)

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Teams want preview environments of their own, and the kit shouldn't need a release for
each one.

- `defineFamily(name, prefix)`: adds a family called `name` that `use` accepts from now on.
  Its components are named `"<prefix>-queue"`, `"<prefix>-store"` and `"<prefix>-clock"`.
  Components of a defined family follow every rule the built-in families do, IDs and
  wiring included: two families with the same prefix are still different families. An
  empty name or prefix, or a name that's already a family (built-in or defined), fails.

For example, after `defineFamily("preview", "kind")` and `use("preview")`, a new kit's
first component of kind `"store"` is `"kind-store#1"`.
