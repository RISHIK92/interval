# Symbol interner

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A tokenizer meets the same identifiers over and over: `x`, `count`, `foo`. Instead of
storing every occurrence, it keeps each distinct text once, as an immutable symbol shared
by every occurrence, and hands out a stable integer ID for it. Build that interner, and
count the bytes it saves.

- `Interner()`: no symbols.
- `intern(text)`: the text's ID. The first time a text is seen it gets the next ID, counting
  from 0 in the order texts are first seen; after that, the same text always gets the same
  ID. Texts are compared exactly (case and spaces matter). An empty text fails.
- `lookup(id)`: the text with that ID. An ID that hasn't been handed out (negative, or not
  less than `size()`) fails.
- `size()`: how many distinct texts are stored.
- `bytesSaved()`: the bytes not stored compared with storing every occurrence: each
  `intern` of a text already stored saves the text's length (one byte per character).

A call that fails changes nothing. Texts are printable ASCII of at most 100 characters,
and there are at most 10^4 calls.

For example, interning `"count"`, `"total"`, `"count"` and `"count"` returns 0, 1, 0 and 0;
then `size()` is 2, `bytesSaved()` is 10 and `lookup(1)` is `"total"`.
