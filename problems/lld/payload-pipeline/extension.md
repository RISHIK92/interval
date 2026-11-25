# Payload encoders: a check digit (extension round)

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

One transport flips the odd character, and nobody notices until a payload fails to parse
three services later. A check digit catches it at the edge.

- `checksum()`: pushes a `"checksum"` layer on the outside of the stack, exactly as
  `push` would push any other layer. It counts towards the eight layers, so a ninth fails,
  and it shows in `layers()` as `"checksum"`.
- Encoding a payload `p` through it appends one digit: the sum of `p`'s character codes,
  mod 10 (`"hi"` is 104 + 105 = 209, so `"hi9"`).
- Decoding follows the same rule as every layer: it fails unless the text is exactly some
  payload followed by that payload's digit, so a wrong or missing digit fails.
- `push("checksum")` still fails: the layer is only added through `checksum()`.
