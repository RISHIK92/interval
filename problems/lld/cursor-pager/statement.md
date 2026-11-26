# Cursor pagination

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A search returns a sorted result set, and clients read it in two ways: one item at a
time, or a page at a time. Pages are fetched with a cursor that names the last item the
client saw, not an offset, so a cursor still means the same place if the results change.

- `ResultPager(items, pageSize)`: the results are the items, sorted by character code.
  An empty item, an item listed twice, or a page size outside 1 to 1000 fails. The list
  may be empty.
- `hasNext()`: whether `next()` has an item to return.
- `next()`: walks the results: the first call returns the first item, and each later call
  returns the item after the one it returned last. It fails when no items are left, and
  then changes nothing.
- `page(cursor)`: the items after the cursor, in order, at most `pageSize` of them (fewer,
  or none, at the end of the results). The cursor `""` means the start of the results,
  so `page("")` is the first page. Any other cursor must be one of the items, or the call
  fails.
- `nextCursor(cursor)`: the cursor for the page after `page(cursor)`: that page's last
  item, or null when no item comes after that page (including when it's empty). It fails
  exactly when `page(cursor)` does.

Paging and walking are independent: `page` and `nextCursor` never change what `next()`
returns. Items are printable ASCII and case-sensitive, at most 100 characters each,
there are at most 10^4 items, and there are at most 10^4 calls.

For example, with the items `["fig", "apple", "kiwi", "date", "banana", "cherry",
"grape", "elder"]` and a page size of 3, `page("")` is `["apple", "banana", "cherry"]`
and `nextCursor("")` is `"cherry"`. `page("cherry")` is `["date", "elder", "fig"]`, and
`page("fig")` is `["grape", "kiwi"]`, with a next cursor of null.
