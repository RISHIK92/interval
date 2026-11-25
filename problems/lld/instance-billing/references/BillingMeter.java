import java.util.*;
import java.util.function.LongFunction;

public class BillingMeter {
  private static final long MAX_RATE = 1_000_000L;
  private static final long MAX_HOURS = 10_000L;

  // One instance: the hours it has run. Each kind turns them into cents its own way.
  private abstract static class Instance {
    protected final long hourly;
    protected long hours = 0;

    Instance(long hourly) {
      this.hourly = hourly;
    }

    void run(long hours) {
      this.hours += hours;
    }

    abstract long bill();

    boolean interrupt() {
      throw new IllegalStateException("only a spot instance can be interrupted");
    }
  }

  private static final class OnDemand extends Instance {
    OnDemand(long hourly) {
      super(hourly);
    }

    long bill() {
      return hours * hourly;
    }
  }

  private static final class Reserved extends Instance {
    Reserved(long hourly) {
      super(hourly);
    }

    // 100 hours paid up front, then 60% of the rate over all the hours run.
    long bill() {
      return 100 * hourly + hours * hourly * 60 / 100;
    }
  }

  private static final class Spot extends Instance {
    Spot(long hourly) {
      super(hourly);
    }

    private boolean interrupted = false;

    // Once interrupted, runs are still accepted but no longer billed.
    @Override
    void run(long hours) {
      if (!interrupted) super.run(hours);
    }

    long bill() {
      return hours * hourly * 30 / 100;
    }

    @Override
    boolean interrupt() {
      boolean first = !interrupted;
      interrupted = true;
      return first;
    }
  }

  private static final class Dedicated extends Instance {
    private final long hostFee;
    private long runs = 0;

    Dedicated(long hourly, long hostFee) {
      super(hourly);
      this.hostFee = hostFee;
    }

    @Override
    void run(long hours) {
      super.run(hours);
      runs++;
    }

    long bill() {
      return hours * hourly + runs * hostFee;
    }
  }

  private static final Map<String, LongFunction<Instance>> KINDS =
      Map.of("on-demand", OnDemand::new, "reserved", Reserved::new, "spot", Spot::new);

  private final Map<String, Instance> instances = new HashMap<>();

  private static long rate(long cents) {
    if (cents < 1 || cents > MAX_RATE) throw new IllegalArgumentException("hourlyCents must be within 1 and 10^6");
    return cents;
  }

  private void add(String id, Instance instance) {
    if (id.isEmpty() || instances.containsKey(id))
      throw new IllegalArgumentException("an instance needs a new, non-empty id");
    instances.put(id, instance);
  }

  private Instance find(String id) {
    Instance instance = instances.get(id);
    if (instance == null) throw new NoSuchElementException("no such instance");
    return instance;
  }

  public BillingMeter() {}

  public void launch(String id, String kind, long hourlyCents) {
    LongFunction<Instance> make = KINDS.get(kind);
    if (make == null) throw new IllegalArgumentException("unknown kind");
    add(id, make.apply(rate(hourlyCents)));
  }

  public void run(String id, long hours) {
    if (hours < 1 || hours > MAX_HOURS) throw new IllegalArgumentException("hours must be within 1 and 10^4");
    find(id).run(hours);
  }

  public long bill(String id) {
    return find(id).bill();
  }

  public long total() {
    long sum = 0;
    for (Instance instance : instances.values()) sum += instance.bill();
    return sum;
  }

  public boolean interrupt(String id) {
    return find(id).interrupt();
  }

  // The extension round: a fourth kind, added without touching the others.
  public void launchDedicated(String id, long hourlyCents, long hostFeeCents) {
    if (hostFeeCents < 0 || hostFeeCents > MAX_RATE)
      throw new IllegalArgumentException("hostFeeCents must be within 0 and 10^6");
    add(id, new Dedicated(rate(hourlyCents), hostFeeCents));
  }
}
