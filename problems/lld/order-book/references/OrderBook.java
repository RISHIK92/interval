import java.util.*;

public class OrderBook {
  private static final long MAX = 1_000_000;

  private static class Order {
    String side;
    long price;
    long qty;
    String state;

    Order(String side, long price, long qty, String state) {
      this.side = side;
      this.price = price;
      this.qty = qty;
      this.state = state;
    }
  }

  // Open orders per side: price -> ids in time priority, oldest first.
  private final Map<String, TreeMap<Long, ArrayDeque<String>>> levels = new HashMap<>();
  // Every id ever accepted. Ids are never reused.
  private final Map<String, Order> orders = new HashMap<>();
  // The extension round: all quantity matched so far.
  private long matched = 0;

  public OrderBook() {
    levels.put("buy", new TreeMap<>());
    levels.put("sell", new TreeMap<>());
  }

  private static void checkSide(String side) {
    if (!side.equals("buy") && !side.equals("sell"))
      throw new IllegalArgumentException("side must be buy or sell");
  }

  private Order open(String id) {
    Order order = orders.get(id);
    if (order == null) throw new NoSuchElementException("unknown id");
    if (!order.state.equals("open")) throw new IllegalStateException("order is not open");
    return order;
  }

  private Long bestOf(String side) {
    TreeMap<Long, ArrayDeque<String>> prices = levels.get(side);
    if (prices.isEmpty()) return null;
    return side.equals("buy") ? prices.lastKey() : prices.firstKey();
  }

  public synchronized List<String> place(String id, String side, long price, long qty) {
    checkSide(side);
    if (price < 1 || price > MAX) throw new IllegalArgumentException("price out of range");
    if (qty < 1 || qty > MAX) throw new IllegalArgumentException("quantity out of range");
    if (id.isEmpty()) throw new IllegalArgumentException("empty id");
    if (orders.containsKey(id)) throw new IllegalStateException("duplicate id");
    String other = side.equals("buy") ? "sell" : "buy";
    List<String> fills = new ArrayList<>();
    while (qty > 0) {
      Long best = bestOf(other);
      if (best == null) break;
      if ((side.equals("buy") && best > price) || (side.equals("sell") && best < price)) break;
      ArrayDeque<String> queue = levels.get(other).get(best);
      String makerId = queue.peekFirst();
      Order maker = orders.get(makerId);
      long took = Math.min(qty, maker.qty);
      fills.add(makerId + ":" + best + ":" + took);
      qty -= took;
      maker.qty -= took;
      matched += took;
      if (maker.qty == 0) {
        maker.state = "filled";
        queue.pollFirst();
        if (queue.isEmpty()) levels.get(other).remove(best);
      }
    }
    if (qty > 0) {
      orders.put(id, new Order(side, price, qty, "open"));
      levels.get(side).computeIfAbsent(price, p -> new ArrayDeque<>()).addLast(id);
    } else {
      orders.put(id, new Order(side, price, 0, "filled"));
    }
    return fills;
  }

  public synchronized long cancel(String id) {
    Order order = open(id);
    ArrayDeque<String> queue = levels.get(order.side).get(order.price);
    queue.remove(id);
    if (queue.isEmpty()) levels.get(order.side).remove(order.price);
    long left = order.qty;
    order.qty = 0;
    order.state = "cancelled";
    return left;
  }

  public synchronized Long remaining(String id) {
    Order order = orders.get(id);
    if (order == null || !order.state.equals("open")) return null;
    return order.qty;
  }

  public synchronized Long best(String side) {
    checkSide(side);
    return bestOf(side);
  }

  public synchronized List<Long> depth(String side, long levelCount) {
    checkSide(side);
    if (levelCount < 0) throw new IllegalArgumentException("negative levels");
    TreeMap<Long, ArrayDeque<String>> prices = levels.get(side);
    Collection<Long> ordered =
        side.equals("buy") ? prices.descendingKeySet() : prices.navigableKeySet();
    List<Long> out = new ArrayList<>();
    long shown = 0;
    for (Long p : ordered) {
      if (shown++ >= levelCount) break;
      long total = 0;
      for (String i : prices.get(p)) total += orders.get(i).qty;
      out.add(p);
      out.add(total);
    }
    return out;
  }

  public synchronized void modify(String id, long qty) {
    Order order = open(id);
    if (qty < 1 || qty > MAX) throw new IllegalArgumentException("quantity out of range");
    if (qty > order.qty) {
      // Growing an order costs its place in the queue.
      ArrayDeque<String> queue = levels.get(order.side).get(order.price);
      queue.remove(id);
      queue.addLast(id);
    }
    order.qty = qty;
  }

  public synchronized long traded() {
    return matched;
  }
}
