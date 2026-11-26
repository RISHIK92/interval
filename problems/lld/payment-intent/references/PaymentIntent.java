public class PaymentIntent {
  private static final long MAX_CENTS = 1_000_000_000L;

  private static void checkCents(long cents) {
    if (cents < 1 || cents > MAX_CENTS) throw new IllegalArgumentException("cents run from 1 to 10^9");
  }

  // One status and the operations it permits. Everything is refused unless a state says
  // otherwise, so a new state only names what it allows.
  private abstract static class State {
    abstract String name();

    boolean confirm(PaymentIntent intent) {
      return false;
    }

    boolean settle(PaymentIntent intent, boolean succeeded) {
      return false;
    }

    boolean capture(PaymentIntent intent, long cents) {
      return false;
    }

    boolean refund(PaymentIntent intent, long cents) {
      return false;
    }

    boolean dispute(PaymentIntent intent, long cents) {
      return false;
    }
  }

  private static final class AwaitingPayment extends State {
    String name() {
      return "awaiting_payment";
    }

    @Override
    boolean confirm(PaymentIntent intent) {
      intent.state = PROCESSING;
      return true;
    }
  }

  private static final class Processing extends State {
    String name() {
      return "processing";
    }

    // A repeated confirm is a retry of the one that got here: accepted, no change.
    @Override
    boolean confirm(PaymentIntent intent) {
      return true;
    }

    @Override
    boolean settle(PaymentIntent intent, boolean succeeded) {
      intent.state = succeeded ? SUCCEEDED : FAILED;
      return true;
    }
  }

  private static final class Failed extends State {
    String name() {
      return "failed";
    }

    @Override
    boolean settle(PaymentIntent intent, boolean succeeded) {
      return !succeeded;
    }
  }

  private static final class Succeeded extends State {
    String name() {
      return "succeeded";
    }

    @Override
    boolean settle(PaymentIntent intent, boolean succeeded) {
      return succeeded;
    }

    @Override
    boolean capture(PaymentIntent intent, long cents) {
      if (cents > intent.amount - intent.captured) return false;
      intent.captured += cents;
      return true;
    }

    @Override
    boolean refund(PaymentIntent intent, long cents) {
      if (!intent.takeBack(cents)) return false;
      intent.state = REFUNDED;
      return true;
    }

    @Override
    boolean dispute(PaymentIntent intent, long cents) {
      return intent.disputeHeld(cents);
    }
  }

  private static final class Refunded extends State {
    String name() {
      return "refunded";
    }

    @Override
    boolean refund(PaymentIntent intent, long cents) {
      return intent.takeBack(cents);
    }

    @Override
    boolean dispute(PaymentIntent intent, long cents) {
      return intent.disputeHeld(cents);
    }
  }

  private static final class Disputed extends State {
    String name() {
      return "disputed";
    }
  }

  private static final State AWAITING = new AwaitingPayment();
  private static final State PROCESSING = new Processing();
  private static final State FAILED = new Failed();
  private static final State SUCCEEDED = new Succeeded();
  private static final State REFUNDED = new Refunded();
  private static final State DISPUTED = new Disputed();

  // The context: it holds the money and hands each operation to its current state.
  private final long amount;
  private long captured = 0;
  private long refunded = 0;
  private State state = AWAITING;

  public PaymentIntent(long amountCents) {
    checkCents(amountCents);
    this.amount = amountCents;
  }

  public boolean confirm() {
    return state.confirm(this);
  }

  public boolean settle(boolean succeeded) {
    return state.settle(this, succeeded);
  }

  public boolean capture(long cents) {
    checkCents(cents);
    return state.capture(this, cents);
  }

  public boolean refund(long cents) {
    checkCents(cents);
    return state.refund(this, cents);
  }

  public String status() {
    return state.name();
  }

  private boolean takeBack(long cents) {
    if (cents > captured - refunded) return false;
    refunded += cents;
    return true;
  }

  // The extension round: a chargeback freezes the payment.
  public boolean dispute(long cents) {
    checkCents(cents);
    return state.dispute(this, cents);
  }

  private boolean disputeHeld(long cents) {
    if (cents > captured - refunded) return false;
    state = DISPUTED;
    return true;
  }
}
