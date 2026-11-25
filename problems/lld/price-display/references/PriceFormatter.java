import java.util.*;

public class PriceFormatter {
  private static final long MAX_AMOUNT = 1_000_000_000_000L;
  private static final long MAX_UNIT = 1_000_000_000L;
  private static final long MAX_QTY = 1000;

  // How one locale writes an amount. Every line asks this one place, so the same amount
  // reads the same wherever it's shown.
  private record Locale(String sign, boolean signFirst, String grouping, String decimal) {
    String price(long amount) {
      long whole = amount;
      String tail = "";
      if (!decimal.isEmpty()) {
        whole = amount / 100;
        tail = decimal + String.format("%02d", amount % 100);
      }
      String digits = Long.toString(whole);
      Deque<String> groups = new ArrayDeque<>();
      for (int end = digits.length(); end > 0; end -= 3)
        groups.addFirst(digits.substring(Math.max(0, end - 3), end));
      String number = String.join(grouping, groups) + tail;
      return signFirst ? sign + number : number + " " + sign;
    }
  }

  private static long checked(long amount, long most) {
    if (amount < 0 || amount > most) throw new IllegalArgumentException("amount out of range");
    return amount;
  }

  private final Map<String, Locale> locales = new HashMap<>();

  public PriceFormatter() {
    locales.put("en-US", new Locale("$", true, ",", "."));
    locales.put("de-DE", new Locale("EUR", false, ".", ","));
    locales.put("ja-JP", new Locale("JPY", false, ",", ""));
  }

  private Locale locale(String locale) {
    Locale found = locales.get(locale);
    if (found == null) throw new IllegalArgumentException("unknown locale");
    return found;
  }

  public String checkoutLine(long cents, String locale) {
    return "Total: " + locale(locale).price(checked(cents, MAX_AMOUNT));
  }

  public String receiptLine(String item, long cents, long qty, String locale) {
    if (item.isEmpty()) throw new IllegalArgumentException("an item has a name");
    if (qty < 1 || qty > MAX_QTY) throw new IllegalArgumentException("qty must be within 1 and 1000");
    Locale found = locale(locale);
    long unit = checked(cents, MAX_UNIT);
    return item + " " + qty + " x " + found.price(unit) + " = " + found.price(unit * qty);
  }

  public String emailSummary(long totalCents, String locale) {
    return "Your order comes to " + locale(locale).price(checked(totalCents, MAX_AMOUNT)) + ".";
  }

  // The extension round: a locale is data, so a new one changes no line's code.
  public void addLocale(
      String locale, String currencySign, boolean signFirst, String grouping, String decimal) {
    if (locale.isEmpty() || locales.containsKey(locale))
      throw new IllegalArgumentException("a locale needs a new, non-empty name");
    if (currencySign.isEmpty()) throw new IllegalArgumentException("a currency has a sign");
    locales.put(locale, new Locale(currencySign, signFirst, grouping, decimal));
  }
}
