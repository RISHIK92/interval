import java.util.*;

public class VendingMachine {
  private static final long[] COINS = {100, 25, 10, 5};

  private static final class Slot {
    final String item;
    final long price;
    long count;

    Slot(String item, long price, long count) {
      this.item = item;
      this.price = price;
      this.count = count;
    }
  }

  // One monitor for the whole machine: a purchase reads and moves the slot, the credit
  // and the coin inventory together.
  private final Map<String, Slot> slots = new HashMap<>();
  private Map<Long, Long> coins = fresh();
  private Map<Long, Long> pending = fresh();

  private static Map<Long, Long> fresh() {
    Map<Long, Long> m = new HashMap<>();
    for (long c : COINS) m.put(c, 0L);
    return m;
  }

  private Slot slot(String slot) {
    Slot s = slots.get(slot);
    if (s == null) throw new NoSuchElementException("unknown slot");
    return s;
  }

  private void coin(long coin) {
    if (!coins.containsKey(coin)) throw new IllegalArgumentException("not a coin");
  }

  private long credit() {
    long sum = 0;
    for (long c : COINS) sum += c * pending.get(c);
    return sum;
  }

  public synchronized void stock(String slot, String item, long price, long count) {
    if (slot.isEmpty() || item.isEmpty() || price <= 0 || count < 0)
      throw new IllegalArgumentException("invalid stock");
    slots.put(slot, new Slot(item, price, count));
  }

  public synchronized long insert(long coin) {
    coin(coin);
    pending.put(coin, pending.get(coin) + 1);
    return credit();
  }

  public synchronized long balance() {
    return credit();
  }

  public synchronized List<Long> buy(String slot) {
    Slot s = slot(slot);
    if (s.count == 0) throw new IllegalStateException("sold out");
    long total = credit();
    if (total < s.price) throw new IllegalStateException("not enough credit");
    Map<Long, Long> avail = new HashMap<>();
    for (long c : COINS) avail.put(c, coins.get(c) + pending.get(c));
    long rest = total - s.price;
    List<Long> change = new ArrayList<>();
    for (long c : COINS) {
      long take = Math.min(rest / c, avail.get(c));
      for (long i = 0; i < take; i++) change.add(c);
      avail.put(c, avail.get(c) - take);
      rest -= take * c;
    }
    if (rest != 0) throw new IllegalStateException("no exact change");
    coins = avail;
    pending = fresh();
    s.count--;
    return change;
  }

  public synchronized List<Long> refund() {
    List<Long> out = new ArrayList<>();
    for (long c : COINS) for (long i = 0; i < pending.get(c); i++) out.add(c);
    pending = fresh();
    return out;
  }

  public synchronized long inventory(String slot) {
    return slot(slot).count;
  }

  public synchronized String item(String slot) {
    return slot(slot).item;
  }

  public synchronized void restockCoins(long coin, long count) {
    coin(coin);
    if (count <= 0) throw new IllegalArgumentException("count must be positive");
    coins.put(coin, coins.get(coin) + count);
  }

  public synchronized long coinStock(long coin) {
    coin(coin);
    return coins.get(coin);
  }
}
