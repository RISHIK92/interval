import java.util.*;

// On hand = available + reserved, per SKU, after every call: the two maps change
// together and only here.
public class Warehouse {
  private static final long MAX_QTY = 1_000_000_000L;

  private record Order(String sku, long qty) {}

  private final Map<String, Long> onHand = new HashMap<>();
  private final Map<String, Long> reserved = new HashMap<>();
  private final Map<String, Order> open = new HashMap<>();
  private final Set<String> used = new HashSet<>();

  public Warehouse() {}

  private static void named(String... names) {
    for (String n : names) if (n.isEmpty()) throw new IllegalArgumentException("skus and order ids are not empty");
  }

  private static void counted(long qty) {
    if (qty < 1 || qty > MAX_QTY) throw new IllegalArgumentException("qty must be within 1 and 10^9");
  }

  public long receive(String sku, long qty) {
    named(sku);
    counted(qty);
    return onHand.merge(sku, qty, Long::sum);
  }

  public boolean reserve(String orderId, String sku, long qty) {
    named(orderId, sku);
    counted(qty);
    if (used.contains(orderId)) throw new IllegalArgumentException("order id already used");
    if (qty > available(sku)) return false;
    used.add(orderId);
    open.put(orderId, new Order(sku, qty));
    reserved.merge(sku, qty, Long::sum);
    return true;
  }

  private Order close(String orderId) {
    named(orderId);
    Order order = open.remove(orderId);
    if (order != null) reserved.merge(order.sku(), -order.qty(), Long::sum);
    return order;
  }

  public boolean ship(String orderId) {
    Order order = close(orderId);
    if (order == null) return false;
    onHand.merge(order.sku(), -order.qty(), Long::sum);
    return true;
  }

  public boolean cancel(String orderId) {
    return close(orderId) != null;
  }

  public long available(String sku) {
    named(sku);
    return onHand.getOrDefault(sku, 0L) - reserved.getOrDefault(sku, 0L);
  }

  // The extension round: damaged stock leaves, but only from what's available.
  public boolean writeOff(String sku, long qty) {
    counted(qty);
    if (qty > available(sku)) return false;
    onHand.merge(sku, -qty, Long::sum);
    return true;
  }
}
