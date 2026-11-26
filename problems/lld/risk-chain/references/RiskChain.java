import java.util.*;

public class RiskChain {
  private static final long WINDOW_MS = 60_000;

  private record Payment(String customer, long cents, String country, long nowMs) {}

  // What the checks may look at besides the payment: shared by the whole chain.
  private static final class History {
    final Set<String> blocked = new HashSet<>();
    final Map<String, String> home = new HashMap<>();
    final Map<String, ArrayDeque<Long>> recent = new HashMap<>();

    void remember(Payment p) {
      home.putIfAbsent(p.customer(), p.country());
      ArrayDeque<Long> times = recent.computeIfAbsent(p.customer(), k -> new ArrayDeque<>());
      times.addLast(p.nowMs());
      // Times never decrease, so the ones that left the window are at the front.
      for (int i = times.size(); i > 0 && times.peekFirst() <= p.nowMs() - WINDOW_MS; i--)
        times.pollFirst();
    }
  }

  // One link: it decides the payment or returns null to pass it to the next link.
  private interface Check {
    String kind();

    String decide(Payment p, History history);
  }

  private record Blocklist() implements Check {
    public String kind() {
      return "blocklist";
    }

    public String decide(Payment p, History history) {
      return history.blocked.contains(p.customer()) ? "block" : null;
    }
  }

  private record Velocity(long most) implements Check {
    public String kind() {
      return "velocity";
    }

    public String decide(Payment p, History history) {
      return history.recent.get(p.customer()).size() > most ? "review" : null;
    }
  }

  private record AmountLimit(long limit) implements Check {
    public String kind() {
      return "amount";
    }

    public String decide(Payment p, History history) {
      return p.cents() > limit ? "block" : null;
    }
  }

  private record CountryMismatch() implements Check {
    public String kind() {
      return "country";
    }

    public String decide(Payment p, History history) {
      return history.home.get(p.customer()).equals(p.country()) ? null : "review";
    }
  }

  private interface Maker {
    Check make(long param);
  }

  // Each kind with the least param it accepts; blocklist and country take none, so only 0.
  private record Kind(Maker maker, long low, boolean takes) {}

  private static final Map<String, Kind> KINDS =
      Map.of(
          "blocklist", new Kind(n -> new Blocklist(), 0, false),
          "velocity", new Kind(Velocity::new, 1, true),
          "amount", new Kind(AmountLimit::new, 0, true),
          "country", new Kind(n -> new CountryMismatch(), 0, false));

  private final List<Check> checks = new ArrayList<>();
  private final History history = new History();
  private final Map<String, Long> counts =
      new HashMap<>(Map.of("allow", 0L, "review", 0L, "block", 0L));
  private final Set<List<String>> skips = new HashSet<>();

  public RiskChain() {}

  public void addCheck(String check, long param) {
    Kind kind = KINDS.get(check);
    if (kind == null) throw new IllegalArgumentException("unknown check");
    if (param < kind.low() || (param != kind.low() && !kind.takes()))
      throw new IllegalArgumentException("param out of range");
    checks.add(kind.maker().make(param));
  }

  public void block(String customer) {
    if (customer.isEmpty()) throw new IllegalArgumentException("empty customer");
    history.blocked.add(customer);
  }

  public String assess(String customer, long cents, String country, long nowMs) {
    if (customer.isEmpty() || country.isEmpty() || cents < 1)
      throw new IllegalArgumentException("bad payment");
    Payment p = new Payment(customer, cents, country, nowMs);
    history.remember(p);
    String verdict = "allow";
    for (Check check : checks) {
      if (skips.contains(List.of(customer, check.kind()))) continue;
      String decided = check.decide(p, history);
      if (decided != null) {
        verdict = decided;
        break;
      }
    }
    counts.merge(verdict, 1L, Long::sum);
    return verdict;
  }

  public long decisions(String verdict) {
    Long count = counts.get(verdict);
    if (count == null) throw new IllegalArgumentException("unknown verdict");
    return count;
  }

  // The extension round: trusted customers skip a kind of check.
  public boolean skipFor(String customer, String check) {
    if (customer.isEmpty() || !KINDS.containsKey(check))
      throw new IllegalArgumentException("bad skip");
    return skips.add(List.of(customer, check));
  }
}
