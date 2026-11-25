import java.util.*;

public class PaymentOrchestrator {
  private static final long MAX_CENTS = 10_000_000L;
  private static final long MAX_FEE_BPS = 1_000L;
  private static final long MAX_FAILURES = 1_000L;
  private static final long CARD_FIXED_CENTS = 30L;
  private static final long BANK_CAP_CENTS = 500L;
  private static final String FAILED = "failed";

  // Each kind's fee is its own rule behind one contract: given an amount and a rate in
  // basis points, a fee in whole cents. A new kind is a new rule; nothing that charges
  // changes.
  private interface FeeRule {
    long fee(long cents, long bps);
  }

  private static final class CardFee implements FeeRule {
    public long fee(long cents, long bps) {
      return cents * bps / 10_000 + CARD_FIXED_CENTS;
    }
  }

  private static final class WalletFee implements FeeRule {
    public long fee(long cents, long bps) {
      return cents * bps / 10_000;
    }
  }

  private static final class BankFee implements FeeRule {
    public long fee(long cents, long bps) {
      return Math.min(cents * bps / 10_000, BANK_CAP_CENTS);
    }
  }

  private static final Map<String, FeeRule> FEES =
      Map.of("card", new CardFee(), "wallet", new WalletFee(), "bank", new BankFee());

  // A provider as the orchestrator sees it: something that may fail an attempt, and a fee.
  private static final class Provider {
    final String name;
    private final FeeRule rule;
    private final long bps;
    long failures;

    Provider(String name, FeeRule rule, long bps) {
      this.name = name;
      this.rule = rule;
      this.bps = bps;
    }

    boolean attempt() {
      if (failures == 0) return true;
      failures--;
      return false;
    }

    long fee(long cents) {
      return rule.fee(cents, bps);
    }
  }

  // Settlement: what each provider owes the merchant, and what each charge can still refund.
  private static final class Ledger {
    private static final class Capture {
      final String provider;
      long left;

      Capture(String provider, long left) {
        this.provider = provider;
        this.left = left;
      }
    }

    final Map<String, Long> settled = new HashMap<>();
    private final Map<String, Capture> captures = new HashMap<>();

    void open(String provider) {
      settled.put(provider, 0L);
    }

    void capture(String key, Provider provider, long cents) {
      captures.put(key, new Capture(provider.name, cents));
      settled.merge(provider.name, cents - provider.fee(cents), Long::sum);
    }

    boolean refund(String key, long cents) {
      Capture capture = captures.get(key);
      if (capture == null || cents > capture.left) return false;
      capture.left -= cents;
      settled.merge(capture.provider, -cents, Long::sum);
      return true;
    }
  }

  // Routing: the order a charge tries providers in.
  private static final class Router {
    private long threshold;
    private String preferred;

    List<String> order(List<String> providers, long cents) {
      if (preferred == null || cents < threshold) return providers;
      List<String> out = new ArrayList<>(List.of(preferred));
      for (String p : providers) if (!p.equals(preferred)) out.add(p);
      return out;
    }

    void prefer(long threshold, String provider) {
      this.threshold = threshold;
      this.preferred = provider;
    }
  }

  private static String named(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("an empty name");
    return text;
  }

  private static long checkedCents(long cents) {
    if (cents < 1 || cents > MAX_CENTS) throw new IllegalArgumentException("cents are 1 to 10^7");
    return cents;
  }

  private final Map<String, Provider> providers = new HashMap<>();
  private final Map<String, String> outcomes = new HashMap<>();
  private final Ledger ledger = new Ledger();
  private final Router router = new Router();

  public PaymentOrchestrator() {}

  public void provider(String name, String kind, long feeBps) {
    FeeRule rule = FEES.get(kind);
    if (providers.containsKey(named(name)) || rule == null)
      throw new IllegalArgumentException("a new provider of a known kind");
    if (feeBps < 0 || feeBps > MAX_FEE_BPS) throw new IllegalArgumentException("a fee is 0 to 1000 basis points");
    providers.put(name, new Provider(name, rule, feeBps));
    ledger.open(name);
  }

  public void failProvider(String name, long times) {
    if (times < 0 || times > MAX_FAILURES) throw new IllegalArgumentException("times is 0 to 1000");
    known(name).failures = times;
  }

  public String charge(String key, String customer, long cents, List<String> providers) {
    named(key);
    named(customer);
    checkedCents(cents);
    if (providers.isEmpty() || new HashSet<>(providers).size() != providers.size())
      throw new IllegalArgumentException("one or more distinct providers");
    List<Provider> tried = new ArrayList<>();
    for (String p : router.order(providers, cents)) tried.add(known(p));
    String known = outcomes.get(key);
    if (known != null) return known;
    String outcome = FAILED;
    for (Provider provider : tried)
      if (provider.attempt()) {
        ledger.capture(key, provider, cents);
        outcome = "captured:" + provider.name;
        break;
      }
    outcomes.put(key, outcome);
    return outcome;
  }

  public boolean refund(String key, long cents) {
    if (!outcomes.containsKey(named(key))) throw new NoSuchElementException("an unknown key");
    return ledger.refund(key, checkedCents(cents));
  }

  public long settled(String provider) {
    return ledger.settled.get(known(provider).name);
  }

  // The extension round.
  public void routeByAmount(long thresholdCents, String provider) {
    router.prefer(checkedCents(thresholdCents), known(provider).name);
  }

  private Provider known(String name) {
    Provider found = providers.get(name);
    if (found == null) throw new NoSuchElementException("an unknown provider");
    return found;
  }
}
