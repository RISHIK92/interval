import java.util.*;

public class TaskScheduler {
  private static class Task {
    final long priority;
    final List<String> deps;
    // queued, running, done or cancelled.
    String state = "queued";

    Task(long priority, List<String> deps) {
      this.priority = priority;
      this.deps = new ArrayList<>(deps);
    }
  }

  // Insertion order is the order of adding, which breaks priority ties.
  private final Map<String, Task> tasks = new LinkedHashMap<>();

  private boolean ready(Task t) {
    if (!t.state.equals("queued")) return false;
    for (String d : t.deps) if (!tasks.get(d).state.equals("done")) return false;
    return true;
  }

  public synchronized void add(String id, long priority, List<String> deps) {
    if (tasks.containsKey(id)) throw new IllegalArgumentException("duplicate id");
    for (String d : deps)
      if (!tasks.containsKey(d)) throw new IllegalArgumentException("unknown dependency");
    tasks.put(id, new Task(priority, deps));
  }

  public synchronized String next() {
    String best = null;
    for (Map.Entry<String, Task> e : tasks.entrySet()) {
      // Strictly greater, so the earliest added keeps a tie.
      if (ready(e.getValue()) && (best == null || e.getValue().priority > tasks.get(best).priority))
        best = e.getKey();
    }
    if (best != null) tasks.get(best).state = "running";
    return best;
  }

  public synchronized void complete(String id) {
    Task t = tasks.get(id);
    if (t == null || !t.state.equals("running")) throw new IllegalArgumentException("not running");
    t.state = "done";
  }

  public synchronized String status(String id) {
    Task t = tasks.get(id);
    if (t == null) throw new IllegalArgumentException("unknown id");
    if (t.state.equals("queued")) return ready(t) ? "ready" : "waiting";
    return t.state;
  }

  // The extension round.
  public synchronized long cancel(String id) {
    Task t = tasks.get(id);
    if (t == null) throw new IllegalArgumentException("unknown id");
    if (t.state.equals("done")) throw new IllegalArgumentException("already done");
    if (t.state.equals("cancelled")) return 0;
    // Dependencies are always added first, so one pass in order finds every dependent.
    Set<String> gone = new HashSet<>();
    gone.add(id);
    t.state = "cancelled";
    for (Map.Entry<String, Task> e : tasks.entrySet()) {
      Task o = e.getValue();
      if (!o.state.equals("queued")) continue;
      for (String d : o.deps)
        if (gone.contains(d)) {
          o.state = "cancelled";
          gone.add(e.getKey());
          break;
        }
    }
    return gone.size();
  }
}
