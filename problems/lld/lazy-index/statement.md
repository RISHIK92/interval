# Lazy search index

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A runbook search box indexes every runbook so a word can be looked up fast. Building that
index reads every document, and most processes that load the runbooks never search them
at all. So the index sits behind a stand-in with the same calls: it holds the documents
as they arrive and builds the real index only when the first search needs it. After that
it never builds again: each document added later is indexed on its own. The builds are
counted, so the laziness can be checked.

A document's **terms** are the runs of ASCII letters and digits in its text, lowercased:
`"Disk full on db-1"` has the terms `disk`, `full`, `on`, `db` and `1`. Any other character
only separates terms.

- `LazyIndex()`: an index with no documents and no builds.
- `addDoc(id, text)`: adds a document, or replaces the text of the document with that id.
  Before the first search it is only held; after it, the document is indexed straight
  away. An empty id or text fails. A text may have no terms at all (`"..."`): it is still a
  document.
- `search(term)`: the ids of the documents that have `term` as one of their terms, sorted
  by character code. The match ignores case, so `"DISK"` finds `disk`. The first search
  builds the index from every document held so far; later searches never build. A term
  that is empty or has any character other than an ASCII letter or digit fails, and builds
  nothing.
- `builds()`: how many times the index has been built: 0 before the first search, 1 after.
- `indexed()`: how many documents the built index holds: 0 until the first search, then
  every document, including those added later.

A call that fails changes nothing. Ids and texts are printable ASCII (spaces allowed), and
ids are case-sensitive. There are at most 10^4 calls, and a text has at most 1,000
characters.

For example, after adding `"d1"` as `"Disk full on db-1"` and `"d2"` as
`"DB failover finished"`, `builds()` and `indexed()` are both 0. `search("db")` returns
`["d1", "d2"]`, and then `builds()` is 1 and `indexed()` is 2. Adding `"d3"` afterwards
keeps `builds()` at 1 and makes `indexed()` 3.
