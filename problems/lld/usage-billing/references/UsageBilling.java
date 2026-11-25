import java.util.*;

public class UsageBilling {
  private static final long MAX_UNITS = 1_000_000_000L;
  private static final long MAX_MINIMUM_CENTS = 1_000_000_000L;
  private static final long MAX_RATE = 1_000_000L;
  private static final int MAX_TIERS = 10;

  // How a metric turns a customer's units into cents.
  private abstract static class Pricing {
    final long[] starts;
    final long[] rates;

    Pricing(List<List<Long>> tiers) {
      if (tiers.isEmpty() || tiers.size() > MAX_TIERS)
        throw new IllegalArgumentException("1-10 tiers");
      starts = new long[tiers.size()];
      rates = new long[tiers.size()];
      for (int i = 0; i < tiers.size(); i++) {
        List<Long> t = tiers.get(i);
        if (t.size() != 2) throw new IllegalArgumentException("each tier is [start, centsPerUnit]");
        starts[i] = t.get(0);
        rates[i] = t.get(1);
      }
      if (starts[0] != 0 || starts[starts.length - 1] > MAX_UNITS)
        throw new IllegalArgumentException("starts begin at 0, up to 10^9");
      for (int i = 0; i < starts.length; i++) {
        if (i > 0 && starts[i] <= starts[i - 1]) throw new IllegalArgumentException("starts rise");
        if (rates[i] < 0 || rates[i] > MAX_RATE) throw new IllegalArgumentException("rates within 0-10^6");
      }
    }

    abstract long charge(long units);
  }

  private static final class Graduated extends Pricing {
    Graduated(List<List<Long>> tiers) {
      super(tiers);
    }

    long charge(long units) {
      long total = 0;
      for (int i = starts.length - 1; i >= 0; i--) {
        long above = Math.max(units - starts[i], 0);
        total += above * rates[i];
        units -= above;
      }
      return total;
    }
  }

  private static final class Volume extends Pricing {
    Volume(List<List<Long>> tiers) {
      super(tiers);
    }

    long charge(long units) {
      int i = starts.length - 1;
      while (starts[i] >= units) i--;
      return units * rates[i];
    }
  }

  private final Map<String, Pricing> pricing = new HashMap<>();
  private final Map<String, Long> minimums = new HashMap<>();
  private final Map<String, Map<String, Long>> usage = new HashMap<>();

  public UsageBilling() {}

  public void price(String metric, String model, List<List<Long>> tiers) {
    if (metric.isEmpty()) throw new IllegalArgumentException("a named metric");
    Pricing p;
    if (model.equals("graduated")) p = new Graduated(tiers);
    else if (model.equals("volume")) p = new Volume(tiers);
    else throw new IllegalArgumentException("unknown model");
    pricing.put(metric, p);
  }

  public void meter(String customer, String metric, long units) {
    if (customer.isEmpty() || !pricing.containsKey(metric) || units < 1 || units > MAX_UNITS)
      throw new IllegalArgumentException("a customer, a priced metric and 1-10^9 units");
    usage.computeIfAbsent(customer, k -> new LinkedHashMap<>()).merge(metric, units, Long::sum);
  }

  private long line(String metric, long units) {
    long charge = pricing.get(metric).charge(units);
    Long least = minimums.get(metric);
    return least == null ? charge : Math.max(charge, least);
  }

  public Map<String, Long> invoice(String customer) {
    Map<String, Long> out = new LinkedHashMap<>();
    for (Map.Entry<String, Long> e : usage.getOrDefault(customer, Map.of()).entrySet())
      out.put(e.getKey(), line(e.getKey(), e.getValue()));
    return out;
  }

  public long total(String customer) {
    long sum = 0;
    for (long v : invoice(customer).values()) sum += v;
    return sum;
  }

  // The extension round.
  public void minimum(String metric, long cents) {
    if (!pricing.containsKey(metric) || cents < 0 || cents > MAX_MINIMUM_CENTS)
      throw new IllegalArgumentException("a priced metric and 0-10^9 cents");
    minimums.put(metric, cents);
  }
}
