import java.util.*;

public class Money {
  private static final long LIMIT = 1_000_000_000_000L;
  private final long cents;
  private final String currency;

  public Money(long cents, String currency) {
    checked(cents, currency);
    this.cents = cents;
    this.currency = currency;
  }

  private static void checked(long cents, String currency) {
    if (cents < 0 || cents > LIMIT) throw new IllegalArgumentException("cents must be within 0 and 10^12");
    if (!currency.matches("[A-Z]{3}")) throw new IllegalArgumentException("a currency is three capital letters");
  }

  private String show(long amount) {
    return String.format("%s %d.%02d", currency, amount / 100, amount % 100);
  }

  public String add(long cents, String currency) {
    checked(cents, currency);
    if (!currency.equals(this.currency)) throw new IllegalArgumentException("can't add across currencies");
    return show(this.cents + cents);
  }

  public List<String> split(long parts) {
    if (parts < 1 || parts > 100) throw new IllegalArgumentException("parts must be within 1-100");
    long share = cents / parts, left = cents % parts;
    List<String> out = new ArrayList<>();
    for (long i = 0; i < parts; i++) out.add(show(share + (i < left ? 1 : 0)));
    return out;
  }

  public String display() {
    return show(cents);
  }

  // The extension round.
  public List<String> allocate(List<Long> weights) {
    if (weights.isEmpty() || weights.size() > 100) throw new IllegalArgumentException("1-100 weights");
    long total = 0;
    for (long w : weights) {
      if (w < 0 || w > 1000) throw new IllegalArgumentException("each weight within 0-1000");
      total += w;
    }
    if (total == 0) throw new IllegalArgumentException("at least one weight above 0");
    long[] shares = new long[weights.size()];
    long left = cents;
    for (int i = 0; i < shares.length; i++) {
      shares[i] = cents * weights.get(i) / total;
      left -= shares[i];
    }
    for (int i = 0; i < shares.length && left > 0; i++)
      if (weights.get(i) > 0) {
        shares[i]++;
        left--;
      }
    List<String> out = new ArrayList<>();
    for (long s : shares) out.add(show(s));
    return out;
  }
}
