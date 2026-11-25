# Payload encoders

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A webhook relay passes payloads through transports that each want them in a different
shape: one only carries base64, another wants hex, a stream needs each message framed with
its length. Each encoder is a layer that wraps whatever is underneath it, and layers stack
in any order. Decoding peels them off in exactly the reverse order, and anything that the
stack could not have produced fails.

A **payload** is a non-empty string of printable ASCII (character codes 32 to 126, so
spaces are allowed). Each layer turns a payload into another payload:

| Layer      | Encoding a payload `p`                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `"base64"` | standard base64 of `p`'s character codes: alphabet `A-Z`, `a-z`, `0-9`, `+`, `/`, padded with `=` to a multiple of 4 (`"hi"` gives `"aGk="`) |
| `"hex"`    | two lowercase hex digits per character (`"hi"` gives `"6869"`)                                                                               |
| `"frame"`  | `p`'s length in decimal, a colon, then `p` (`"hi"` gives `"2:hi"`)                                                                           |

- `PayloadPipeline()`: a pipeline with no layers. With no layers, encoding and decoding
  both return the text unchanged.
- `push(layer)`: adds a layer on the outside of the stack. A layer not in the table (case
  matters), or a ninth layer, fails.
- `encode(text)`: applies the layers to `text`, first pushed first, and returns the result.
  A `text` that isn't a payload (the empty string, say) fails.
- `decode(text)`: undoes the layers, last pushed first, and returns the original payload.
  It succeeds exactly when some payload would encode to `text` character for character,
  and fails otherwise. So, among others, these fail:
  - base64 with a character outside the alphabet, missing or extra `=`, or unused bits
    that aren't zero (`"YR=="` fails: `"a"` encodes to `"YQ=="`);
  - hex with an odd number of digits, a non-hex character, or an uppercase digit;
  - a frame whose length doesn't match, has a leading zero or a sign, or has no colon;
  - any layer whose undone result is empty or has a character outside printable ASCII
    (hex `"7f"` fails, and so does a frame `"0:"`).

  A `text` that isn't a payload fails.

- `layers()`: the layer names, first pushed first.

A call that fails changes nothing. There are at most 1,000 calls, a text passed to `encode`
has at most 20 characters, and one passed to `decode` at most 6,000.

For example, after `push("hex")` and `push("frame")`, `encode("hi")` returns `"4:6869"`
and `decode("4:6869")` returns `"hi"`, while `decode("5:6869")` and `decode("4:6G69")`
fail.
