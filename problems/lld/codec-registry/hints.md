> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When a fourth format arrives, which code should have to change: the part that picks a content type, the part that encodes, or only something new?

## Approach

Give every codec the same small interface (encode a list of name and value pairs) and make each format its own implementation. Keep a table from codec name to a way of making that codec, so `add` creates the codec once and stores it against the content type; negotiation and encoding then only ever deal with that interface. Negotiation is plain parsing and arithmetic: turn the header into a map from range to quality, kept in thousandths so no floating-point comparison is needed, then walk the registered types in the order they were added and look up each one's most specific matching range. Sorting the fields before handing them to the codec keeps the ordering rule in one place.

## Code sketch

```text
interface Codec
  encode(pairs) -> string
class JsonCodec / FormCodec / CsvCodec implements Codec
makers: map codec name -> () -> Codec

parseAccept(header) -> map range -> quality
  // TODO: split items on ",", parameters on ";"
  // TODO: check the grammar; quality in thousandths

class CodecRegistry
  codecs: ordered map content type -> Codec

  add(contentType, codec)
    // TODO: check the type, not yet added
    // TODO: codecs[contentType] = makers[codec]()
  negotiate(accept) -> optional string
    // TODO: for each type: exact, else top/*, else */*
    // TODO: keep the first with the highest quality > 0
  encodeWith(contentType, fields) -> string
    // TODO: check; sort fields; let the codec encode
```
