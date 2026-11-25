# Lazy search index: removing documents (extension round)

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Runbooks get retired, and a retired one must stop turning up in searches.

- `removeDoc(id)`: removes the document and returns true; it no longer turns up in any
  search and no longer counts in `indexed()`. An id with no document is refused: false.
  An empty id fails.
- Like adding, removing never builds the index: before the first search it only drops the
  held document, and after it the document leaves the built index on its own.
- A removed id can be added again later, with any text.
