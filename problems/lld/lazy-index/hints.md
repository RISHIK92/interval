> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

At what single moment does the stand-in have to swap the documents it holds for a real index?

## Approach

Split the work between two classes with the same calls. The real inverted index maps each term to the set of document ids that contain it, plus each document's own terms so a replaced document's old terms can be taken out first; its constructor indexes a batch of documents. The proxy holds a plain map of id to text and a reference to the real index that starts empty. Adding a document goes into the map while there is no real index, and straight into the real one after. A valid search creates the real index from the map the first time and counts that build; every search then just delegates. `indexed()` asks the real index for its size, or answers 0 while it doesn't exist.

## Code sketch

```text
interface SearchIndex
  addDoc(id, text); search(term) -> list

class InvertedIndex implements SearchIndex
  postings: map term -> set of ids
  docs: map id -> set of terms
  constructor(pending)   // TODO: addDoc each one
  addDoc(id, text)       // TODO: drop old terms, add new
  search(term) -> list   // TODO: lowercase, sorted ids
  size() -> int

class LazyIndex implements SearchIndex
  pending: map id -> text
  real: InvertedIndex or nothing
  buildCount: int

  addDoc(id, text)  // TODO: fail on empty; pending or real
  search(term)
    // TODO: fail unless letters and digits
    // TODO: build real from pending once, count it
  builds() -> int
  indexed() -> int   // TODO: 0 until built
```
