import java.util.*;

public class InvoiceRun {
  private static final long MAX_CENTS = 10_000_000L;
  // Tax rates in basis points (hundredths of a percent), so cents times a rate is in
  // ten-thousandths of a cent.
  private static final Map<String, Long> RATES = Map.of("us", 725L, "eu", 2100L, "jp", 1000L);
  private static final long BASIS = 10_000L;

  // What the run knows about one customer between invoices.
  private static final class Account {
    long usage = 0;
    long balance = 0;
    long rate = 0;
    long coupon = 0;
  }

  // The invoice on its way through the steps. `due` is what is still to be charged:
  // each step reads it and takes its part off. Tax stays in ten-thousandths of a cent
  // until rounding.
  private static final class Draft {
    final long subtotal;
    long due;
    long credited;
    long taxExact;
    long tax;

    Draft(long subtotal) {
      this.subtotal = subtotal;
      this.due = subtotal;
    }
  }

  // Each step is one concern: it sees only what is due, never how earlier steps got there.
  private static void discount(Draft draft, Account account) {
    draft.due -= draft.due * account.coupon / 100;
  }

  private static void credits(Draft draft, Account account) {
    draft.credited = Math.min(account.balance, draft.due);
    draft.due -= draft.credited;
  }

  private static void tax(Draft draft, Account account) {
    draft.taxExact = draft.due * account.rate;
  }

  private static void rounding(Draft draft) {
    long cents = draft.taxExact / BASIS;
    long rest = draft.taxExact % BASIS;
    draft.tax = 2 * rest >= BASIS ? cents + 1 : cents;
  }

  private static void checkCents(long cents) {
    if (cents < 1 || cents > MAX_CENTS)
      throw new IllegalArgumentException("cents must be within 1 and 10^7");
  }

  private final Map<String, Account> accounts = new HashMap<>();

  public InvoiceRun() {}

  private Account account(String customer) {
    if (customer.isEmpty()) throw new IllegalArgumentException("a customer has a name");
    return accounts.computeIfAbsent(customer, c -> new Account());
  }

  private Account known(String customer) {
    Account found = accounts.get(customer);
    if (found == null) throw new IllegalArgumentException("unknown customer");
    return found;
  }

  public void usage(String customer, long cents) {
    checkCents(cents);
    account(customer).usage += cents;
  }

  public void credit(String customer, long cents) {
    checkCents(cents);
    account(customer).balance += cents;
  }

  public void region(String customer, String region) {
    Long rate = RATES.get(region);
    if (rate == null) throw new IllegalArgumentException("unknown region");
    account(customer).rate = rate;
  }

  public List<Long> invoice(String customer) {
    Account account = known(customer);
    Draft draft = new Draft(account.usage);
    discount(draft, account);
    credits(draft, account);
    tax(draft, account);
    rounding(draft);
    account.usage = 0;
    account.balance -= draft.credited;
    account.coupon = 0;
    return List.of(draft.subtotal, draft.credited, draft.tax, draft.due + draft.tax);
  }

  public long carryOver(String customer) {
    return known(customer).balance;
  }

  // The extension round: one more step, between the subtotal and the credits.
  public void coupon(String customer, long percent) {
    if (percent < 1 || percent > 100)
      throw new IllegalArgumentException("percent must be within 1 and 100");
    account(customer).coupon = percent;
  }
}
