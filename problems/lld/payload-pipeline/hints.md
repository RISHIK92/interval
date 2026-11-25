> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If every layer had to be undone exactly, what is the one check that would reject a bad padding, an uppercase hex digit and a wrong length all at once?

## Approach

Model the stack as decorators around a plain codec that returns text unchanged. Each layer holds the codec it wraps and supplies just two steps, wrap and unwrap; encoding wraps what the inner codec encoded, and decoding unwraps first and then hands the result to the inner codec. Because a layer's output must be exactly what wrapping would produce, the shared decode can unwrap leniently and then insist that the result is a valid payload and that wrapping it gives back the input character for character. That one comparison handles every malformed case, so each unwrap only has to be correct on good input. Pushing a layer replaces the current codec with a new layer around it, and a list of names answers `layers()`.

## Code sketch

```text
interface Codec
  encode(text) -> text; decode(text) -> text

class Plain implements Codec   // returns text as is

abstract class Layer implements Codec
  inner: Codec
  wrap(text), unwrap(text)     // each layer gives these
  encode(text)  // TODO: wrap(inner.encode(text))
  decode(text)
    // TODO: raw = unwrap(text)
    // TODO: fail unless raw is a payload and wrap(raw) == text
    // TODO: return inner.decode(raw)

class Base64, Hex, Frame extends Layer

class PayloadPipeline
  codec: Codec = Plain
  names: list
  push(layer)    // TODO: fail if unknown or full
  encode(text), decode(text)  // TODO: check it's a payload
  layers() -> list
```
