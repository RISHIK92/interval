import java.util.ArrayDeque;

// A FIFO queue with stated contracts. Class invariant, true after every call: it holds
// at most `capacity` items.
public class WorkQueue {
  private static final long MAX_CAPACITY = 1_000;

  private final long capacity;
  private final ArrayDeque<String> items = new ArrayDeque<>();

  // Precondition: a capacity from 1 to 10^3.
  public WorkQueue(long capacity) {
    if (capacity < 1 || capacity > MAX_CAPACITY)
      throw new IllegalArgumentException("capacity is from 1 to 10^3");
    this.capacity = capacity;
  }

  // Precondition: a non-empty item. Postcondition: true with the item at the back, or
  // false with nothing changed when the queue is full.
  public boolean offer(String item) {
    if (item.isEmpty()) throw new IllegalArgumentException("an item is not empty");
    if (items.size() == capacity) return false;
    items.addLast(item);
    return true;
  }

  // Precondition: the queue isn't empty. Postcondition: the oldest item, removed.
  public String take() {
    if (items.isEmpty()) throw new IllegalStateException("the queue is empty");
    return items.removeFirst();
  }

  // No precondition, and it never changes anything.
  public String peekNext() {
    return items.peekFirst();
  }

  public long size() {
    return items.size();
  }
}
