import java.util.*;

public class RunnerPool {
  private static final Set<String> CAPABILITIES = Set.of("build", "test", "deploy", "gpu");

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty name");
  }

  private static Set<String> known(List<String> capabilities) {
    if (!CAPABILITIES.containsAll(capabilities)) throw new IllegalArgumentException("unknown capability");
    return Set.copyOf(capabilities);
  }

  // There is deliberately no Runner interface with build, test, deploy and gpu methods, which
  // would force a build-only runner to stub a deploy. A runner holds only the capabilities it
  // really has, and a job is matched against just the ones it needs.
  private static final class Runner {
    final Set<String> capabilities;
    String job = null;
    boolean draining = false;

    Runner(Set<String> capabilities) {
      this.capabilities = capabilities;
    }

    boolean takes(Set<String> needs) {
      return job == null && !draining && capabilities.containsAll(needs);
    }
  }

  private final LinkedHashMap<String, Runner> runners = new LinkedHashMap<>();
  private final Map<String, String> jobs = new HashMap<>();

  public RunnerPool() {}

  public void addRunner(String name, List<String> capabilities) {
    given(name);
    if (runners.containsKey(name)) throw new IllegalArgumentException("runner already in the pool");
    runners.put(name, new Runner(known(capabilities)));
  }

  public String assign(String job, List<String> needs) {
    given(job);
    Set<String> wanted = known(needs);
    if (jobs.containsKey(job)) throw new IllegalArgumentException("job already running");
    for (Map.Entry<String, Runner> named : runners.entrySet()) {
      if (named.getValue().takes(wanted)) {
        named.getValue().job = job;
        jobs.put(job, named.getKey());
        return named.getKey();
      }
    }
    return null;
  }

  public boolean finish(String job) {
    given(job);
    String name = jobs.remove(job);
    if (name == null) return false;
    runners.get(name).job = null;
    leaveIfDrained(name);
    return true;
  }

  public List<String> busy() {
    List<String> out = new ArrayList<>(jobs.values());
    Collections.sort(out);
    return out;
  }

  // The extension round: a runner on its way out.
  public void drain(String name) {
    given(name);
    Runner runner = runners.get(name);
    if (runner == null) throw new IllegalArgumentException("no such runner");
    runner.draining = true;
    leaveIfDrained(name);
  }

  private void leaveIfDrained(String name) {
    Runner runner = runners.get(name);
    if (runner.draining && runner.job == null) runners.remove(name);
  }
}
