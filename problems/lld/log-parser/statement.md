# Log line parser

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a parser for log lines in named formats of three kinds. Each kind turns a line into
fields its own way, and a line that doesn't fit its format is malformed.

| Kind       | A line is                                                                                                                                                                                                                                                                                     | Fields                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `"kv"`     | one or more tokens separated by single spaces, each `key=value`, split at its first `=`. The key is not empty and appears once; the value may be empty or contain `=`. An empty line, a leading, trailing or doubled space, a token without `=`, an empty key or a repeated key is malformed. | each key to its value                                                               |
| `"csv"`    | the line split at every `,` (there is no quoting), giving exactly as many fields as the format has headers. Fields may be empty.                                                                                                                                                              | each header to its field, in order                                                  |
| `"access"` | `HOST IDENT USER [TIME] "METHOD PATH PROTOCOL" STATUS BYTES`, with single spaces exactly where shown, for example `127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /a.gif HTTP/1.0" 200 2326`. See below.                                                                                 | `host`, `ident`, `user`, `time`, `method`, `path`, `protocol`, `status` and `bytes` |

In an access line, `HOST`, `IDENT` and `USER` are each one or more characters, none of them
a space. `TIME` is one or more characters, none of them `]` (it may contain spaces).
`METHOD`, `PATH` and `PROTOCOL` are each one or more characters, none of them a space or
`"`. `STATUS` is exactly three digits, and `BYTES` is one or more digits or a single `-`.
Nothing comes before or after. Each field is the text between its delimiters, without the
brackets and quotes.

- `LogParser()`: no formats.
- `addFormat(name, kind, headers)`: adds a format. An empty name, a name already in use,
  or a kind that isn't one of the three (case matters) fails. A `csv` format has 1 to 20
  headers, each non-empty and all different; a `kv` or `access` format takes an empty
  list. Anything else fails, and a failed call adds nothing.
- `parse(format, line)`: the line's fields by the named format, as a map. An unknown
  format fails, and a malformed line fails.
- `parsed(format)`: how many lines the format has parsed: calls to `parse` that didn't
  fail. An unknown format fails.

Names, headers and lines are printable ASCII.
