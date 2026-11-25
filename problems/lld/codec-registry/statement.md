# Codec registry

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An API answers in whichever format the client asks for. Codecs are registered by content
type, the client's `Accept` header picks one, and that codec writes a flat record its own
way. New formats will keep arriving, so adding one shouldn't mean editing the code that
negotiates or encodes.

A **token** is a lowercase letter or digit, then any lowercase letters, digits, `.`, `+`
or `-`. A **content type** is `<token>/<token>`, such as `text/csv` or
`application/vnd.api+json`.

- `CodecRegistry()`: no content types registered.
- `add(contentType, codec)`: registers a codec for that content type. `codec` is `"json"`,
  `"form"` or `"csv"` (see below). Anything that isn't a content type, a content type
  already registered, or another codec fails. Several content types may use the same codec.
- `negotiate(accept)`: the registered content type that best fits the `Accept` header, or
  null when none is acceptable.
  - The header is one or more items separated by `,`. Each item is a media range, which
    is `*/*`, `<token>/*` or a content type, optionally followed by `;q=<value>`. Spaces
    before and after each item, and before and after each `;`, are ignored.
  - A q-value is `0` or `1`, or `0.` followed by up to three digits, or `1.` followed by
    up to three zeros. It is 1 when it isn't given.
  - A registered type's quality comes from the most specific range that matches it: the
    type itself, else `<its first token>/*`, else `*/*`. If none matches, or that quality
    is 0, the type isn't acceptable (a less specific range doesn't rescue it).
  - The acceptable type with the highest quality wins. A tie goes to the type registered
    first.
  - A header that doesn't follow this grammar fails, and so does one that lists the same
    range twice or gives any parameter other than `q` (case matters).
- `encodeWith(contentType, fields)`: the record encoded by that content type's codec, with
  fields in order of their names (sorted by character code). An unregistered content type,
  an empty record, or an empty field name or value fails.

| Codec    | Encoding                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"json"` | `{"<name>":"<value>",...}` with no spaces. In names and values, `\` becomes `\\` and `"` becomes `\"`.                                                                                               |
| `"form"` | `<name>=<value>&...`. In names and values, every character except `A`–`Z`, `a`–`z`, `0`–`9`, `-`, `.`, `_` and `~` becomes `%` and its two-digit code in uppercase hex (a space is `%20`).           |
| `"csv"`  | Two lines joined by a newline character (`\n`): the names separated by `,`, then the values separated by `,`. A name or value containing `,` or `"` is wrapped in `"`, with each `"` inside doubled. |

A call that fails changes nothing. Strings are printable ASCII and case-sensitive, and
there are at most 10^4 calls.

For example, with `application/json` and `text/csv` registered, the header
`"text/csv;q=0.5, application/json;q=0.9"` picks `"application/json"`, and the record
`{"name": "Ada Lovelace", "id": "7"}` encodes as `"id,name\n7,Ada Lovelace"` in CSV.
