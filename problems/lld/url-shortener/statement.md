# URL shortener

> PROVISIONAL (P5-W34): written during the build; the owner reviews it before launch.

Build a URL shortener whose codes are deterministic.

- `UrlShortener()`: no arguments.
- `shorten(url)`: returns the url's code. A code is the base62 form of a counter that
  starts at 1, using the digits `0-9`, then `a-z`, then `A-Z` (so the codes run `1`,
  `2`, ... `9`, `a`, ... `z`, `A`, ... `Z`, `10`, `11`, ...). The same url always gets
  the same code. A new url takes the next counter value; a value whose code is already
  taken (by a custom alias) is skipped.
- `expand(code)`: the url behind the code, and it counts one hit for that code. An
  unknown code fails and counts nothing.
- `custom(url, alias)`: makes `alias` a code for the url and returns it. The alias is 1
  to 16 characters from `0-9a-zA-Z`, and not already a code, or the call fails and
  changes nothing. It does not use the counter, and does not change what `shorten(url)`
  returns. Codes are case sensitive.
- `hits(code)`: how many times `expand` returned the code's url through that code (not
  through the url's other codes). An unknown code fails.

A url is valid when it starts with `http://` or `https://`, has at least one character
after that, has no space, and is at most 2048 characters. `shorten` and `custom` fail on
an invalid url, and change nothing.

Several threads may call at once (JavaScript and TypeScript: interleaved async calls).
Every completed call must count.
