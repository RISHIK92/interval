"use strict";

const MAX_PAGE_SIZE = 1000;

function checkItem(item) {
  if (item === "") throw new RangeError("empty item");
}

// The first position whose item is after `item` (strict) or not before it (otherwise).
function bound(items, item, strict) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid] < item || (strict && items[mid] === item)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// An iterator over the shared, sorted items. It remembers the last item it returned, not
// a position, so items inserted around it never make it skip or repeat one.
class Walk {
  #items;
  #last = null;

  constructor(items) {
    this.#items = items;
  }

  #at() {
    return this.#last === null ? 0 : bound(this.#items, this.#last, true);
  }

  hasNext() {
    return this.#at() < this.#items.length;
  }

  next() {
    if (!this.hasNext()) throw new RangeError("no more items");
    this.#last = this.#items[this.#at()];
    return this.#last;
  }
}

// A sorted result set, walked one item at a time or a page at a time. A page's cursor is
// the last item seen, so the next page starts after that item wherever it is now.
class ResultPager {
  #items;
  #size;
  #walk;

  constructor(items, pageSize) {
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE)
      throw new RangeError("bad page size");
    items.forEach(checkItem);
    if (new Set(items).size !== items.length)
      throw new RangeError("an item listed twice");
    // Sorted by character code: the default sort compares UTF-16 code units.
    this.#items = [...items].sort();
    this.#size = pageSize;
    this.#walk = new Walk(this.#items);
  }

  hasNext() {
    return this.#walk.hasNext();
  }

  next() {
    return this.#walk.next();
  }

  page(cursor) {
    const start = this.#after(cursor);
    return this.#items.slice(start, start + this.#size);
  }

  nextCursor(cursor) {
    const end = this.#after(cursor) + this.#size;
    return end < this.#items.length ? this.#items[end - 1] : null;
  }

  // The extension round: the result set grows while it's being walked.
  insertItem(item) {
    checkItem(item);
    if (this.#has(item)) throw new RangeError("already there");
    this.#items.splice(bound(this.#items, item, false), 0, item);
  }

  #has(item) {
    return this.#items[bound(this.#items, item, false)] === item;
  }

  // Where the page after the cursor starts: "" is the start of the results.
  #after(cursor) {
    if (cursor === "") return 0;
    if (!this.#has(cursor)) throw new RangeError("unknown cursor");
    return bound(this.#items, cursor, true);
  }
}

module.exports = { ResultPager };
