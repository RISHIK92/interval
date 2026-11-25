# Handler middleware: unwrapping (extension round)

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A layer added for a rollout sometimes has to come off again.

- `unwrap()`: removes the outermost layer and returns true, so the layer it wrapped is
  outermost again. Returns false when there are no layers. A layer removed is gone for
  good: wrapping the same name again adds a new layer, and a new `request-id` counts from
  the start.
