import java.util.*;

// A sorted result set, walked one item at a time or a page at a time. A page's cursor is
// the last item seen, so the next page starts after that item wherever it is now.
public class ResultPager {
  private static final long MAX_PAGE_SIZE = 1000;

  // An iterator over the shared, sorted items. It remembers the last item it returned,
  // not a position, so items inserted around it never make it skip or repeat one.
  private static final class Walk implements Iterator<String> {
    private final List<String> items;
    private String last = null;

    Walk(List<String> items) {
      this.items = items;
    }

    private int at() {
      return last == null ? 0 : after(items, last);
    }

    public boolean hasNext() {
      return at() < items.size();
    }

    public String next() {
      if (!hasNext()) throw new NoSuchElementException("no more items");
      last = items.get(at());
      return last;
    }
  }

  private final List<String> items;
  private final int size;
  private final Walk walk;

  public ResultPager(List<String> items, long pageSize) {
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new IllegalArgumentException("bad page size");
    for (String item : items) checkItem(item);
    if (new HashSet<>(items).size() != items.size())
      throw new IllegalArgumentException("an item listed twice");
    // String.compareTo compares UTF-16 code units: character code order for ASCII.
    this.items = new ArrayList<>(items);
    Collections.sort(this.items);
    this.size = (int) pageSize;
    this.walk = new Walk(this.items);
  }

  public boolean hasNext() {
    return walk.hasNext();
  }

  public String next() {
    return walk.next();
  }

  public List<String> page(String cursor) {
    int start = start(cursor);
    return new ArrayList<>(items.subList(start, Math.min(start + size, items.size())));
  }

  public String nextCursor(String cursor) {
    int end = start(cursor) + size;
    return end < items.size() ? items.get(end - 1) : null;
  }

  // The extension round: the result set grows while it's being walked.
  public void insertItem(String item) {
    checkItem(item);
    int at = Collections.binarySearch(items, item);
    if (at >= 0) throw new IllegalArgumentException("already there");
    items.add(-at - 1, item);
  }

  private static void checkItem(String item) {
    if (item.isEmpty()) throw new IllegalArgumentException("empty item");
  }

  // The position just after an item that's in the list.
  private static int after(List<String> items, String item) {
    return Collections.binarySearch(items, item) + 1;
  }

  // Where the page after the cursor starts: "" is the start of the results.
  private int start(String cursor) {
    if (cursor.isEmpty()) return 0;
    if (Collections.binarySearch(items, cursor) < 0) throw new IllegalArgumentException("unknown cursor");
    return after(items, cursor);
  }
}
