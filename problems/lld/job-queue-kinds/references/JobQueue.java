import java.util.*;

public class JobQueue {
  private static final long MAX_PRIORITY = 1_000_000L;
  private static final long MAX_MS = 1_000_000_000_000L;

  private record Job(String name, long priority, long notBefore, long seq) {}

  // The contract every kind honours lives here, once: only ready jobs leave, size counts
  // every job, a job leaves once, and peeking asks the same question polling does. A kind
  // only says which ready job comes first, so it can't break any of that.
  private abstract static class Queue {
    private final Map<String, Job> jobs = new HashMap<>();

    protected abstract Comparator<Job> order();

    void push(Job job) {
      jobs.put(job.name(), job);
    }

    Job peek(long now) {
      return jobs.values().stream().filter(job -> job.notBefore() <= now).min(order()).orElse(null);
    }

    Job poll(long now) {
      Job job = peek(now);
      if (job != null) jobs.remove(job.name());
      return job;
    }

    boolean remove(String name) {
      return jobs.remove(name) != null;
    }

    long size() {
      return jobs.size();
    }
  }

  private static final class FifoQueue extends Queue {
    protected Comparator<Job> order() {
      return Comparator.comparingLong(Job::seq);
    }
  }

  private static final class PriorityQueue extends Queue {
    protected Comparator<Job> order() {
      return Comparator.comparingLong((Job job) -> -job.priority()).thenComparingLong(Job::seq);
    }
  }

  private static final class DelayedQueue extends Queue {
    protected Comparator<Job> order() {
      return Comparator.comparingLong(Job::notBefore).thenComparingLong(Job::seq);
    }
  }

  private static long time(long ms) {
    if (ms < 0 || ms > MAX_MS) throw new IllegalArgumentException("a time is 0 to 10^12");
    return ms;
  }

  private final Queue queue;
  private final Set<String> used = new HashSet<>();

  public JobQueue(String kind) {
    queue =
        switch (kind) {
          case "fifo" -> new FifoQueue();
          case "priority" -> new PriorityQueue();
          case "delayed" -> new DelayedQueue();
          default -> throw new IllegalArgumentException("an unknown kind");
        };
  }

  public void push(String job, long priority, long notBeforeMs) {
    if (job.isEmpty() || used.contains(job)) throw new IllegalArgumentException("a job needs a name of its own");
    if (priority < 0 || priority > MAX_PRIORITY) throw new IllegalArgumentException("a priority is 0 to 10^6");
    queue.push(new Job(job, priority, time(notBeforeMs), used.size()));
    used.add(job);
  }

  public String poll(long nowMs) {
    Job job = queue.poll(time(nowMs));
    return job == null ? null : job.name();
  }

  public String peekAt(long nowMs) {
    Job job = queue.peek(time(nowMs));
    return job == null ? null : job.name();
  }

  public long size() {
    return queue.size();
  }

  // The extension round.
  public boolean cancel(String job) {
    if (job.isEmpty()) throw new IllegalArgumentException("an empty job");
    return queue.remove(job);
  }
}
