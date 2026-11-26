const MAX_PAGE_SIZE = 1000;

function checkItem(item: string): void {
  if (item === "") throw new RangeError("empty item");
}

// The first position whose item is after `item` (strict) or not before it (otherwise).
function bound(
  items: readonly string[],
  item: string,
  strict: boolean,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const at = items[mid] ?? "";
    if (at < item || (strict && at === item)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// An iterator over the shared, sorted items. It remembers the last item it returned, not
// a position, so items inserted around it never make it skip or repeat one.
class Walk {
  private readonly items: readonly string[];
  private last: string | null = null;

  constructor(items: readonly string[]) {
    this.items = items;
  }

  private at(): number {
    return this.last === null ? 0 : bound(this.items, this.last, true);
  }

  hasNext(): boolean {
    return this.at() < this.items.length;
  }

  next(): string {
    const item = this.items[this.at()];
    if (item === undefined) throw new RangeError("no more items");
    this.last = item;
    return item;
  }
}

// A sorted result set, walked one item at a time or a page at a time. A page's cursor is
// the last item seen, so the next page starts after that item wherever it is now.
export class ResultPager {
  private readonly items: string[];
  private readonly size: number;
  private readonly walk: Walk;

  constructor(items: string[], pageSize: number) {
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE)
      throw new RangeError("bad page size");
    items.forEach(checkItem);
    if (new Set(items).size !== items.length)
      throw new RangeError("an item listed twice");
    // Sorted by character code: the default sort compares UTF-16 code units.
    this.items = [...items].sort();
    this.size = pageSize;
    this.walk = new Walk(this.items);
  }

  hasNext(): boolean {
    return this.walk.hasNext();
  }

  next(): string {
    return this.walk.next();
  }

  page(cursor: string): string[] {
    const start = this.after(cursor);
    return this.items.slice(start, start + this.size);
  }

  nextCursor(cursor: string): string | null {
    const end = this.after(cursor) + this.size;
    return end < this.items.length ? (this.items[end - 1] ?? null) : null;
  }

  // The extension round: the result set grows while it's being walked.
  insertItem(item: string): void {
    checkItem(item);
    if (this.has(item)) throw new RangeError("already there");
    this.items.splice(bound(this.items, item, false), 0, item);
  }

  private has(item: string): boolean {
    return this.items[bound(this.items, item, false)] === item;
  }

  // Where the page after the cursor starts: "" is the start of the results.
  private after(cursor: string): number {
    if (cursor === "") return 0;
    if (!this.has(cursor)) throw new RangeError("unknown cursor");
    return bound(this.items, cursor, true);
  }
}
