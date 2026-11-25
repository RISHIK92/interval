import java.util.*;

// One call in front of five subsystems: it runs them in order, unwinds the ones that ran
// when one fails, and keeps each service's live versions.
public class DeployFacade {
  // One of the tools a deploy drives (the builder, the registry, the migrator, the
  // cluster, the chat bot). Each can run a release and undo it, and can be set to fail
  // its next run.
  private static final class Subsystem {
    final String name;
    boolean broken = false;

    Subsystem(String name) {
      this.name = name;
    }

    String run(String release) {
      return name + " " + release;
    }

    String undo(String release) {
      return "undo " + name + " " + release;
    }
  }

  private final List<Subsystem> steps = new ArrayList<>();
  private final Map<String, List<String>> live = new HashMap<>();

  public DeployFacade() {
    for (String name : List.of("build", "push", "migrate", "rollout", "announce"))
      steps.add(new Subsystem(name));
  }

  public List<String> deploy(String service, String version) {
    return run(service, version, true);
  }

  public void breakStep(String step) {
    for (Subsystem subsystem : steps) {
      if (subsystem.name.equals(step)) {
        subsystem.broken = true;
        return;
      }
    }
    throw new IllegalArgumentException("unknown step");
  }

  public List<String> history(String service) {
    given(service);
    return new ArrayList<>(live.getOrDefault(service, List.of()));
  }

  public String rollback(String service) {
    given(service);
    List<String> versions = live.getOrDefault(service, new ArrayList<>());
    if (versions.size() < 2) return null;
    versions.remove(versions.size() - 1);
    return versions.get(versions.size() - 1);
  }

  // The extension round: what a deploy would do right now, with nothing changed.
  public List<String> dryRun(String service, String version) {
    return run(service, version, false);
  }

  private List<String> run(String service, String version, boolean real) {
    given(service);
    given(version);
    String release = service + "@" + version;
    List<String> lines = new ArrayList<>();
    Deque<Subsystem> ran = new ArrayDeque<>();
    for (Subsystem step : steps) {
      if (step.broken) {
        if (real) step.broken = false;
        lines.add(step.run(release) + " failed");
        for (Subsystem done : ran) lines.add(done.undo(release));
        return lines;
      }
      lines.add(step.run(release));
      ran.push(step);
    }
    if (real) live.computeIfAbsent(service, s -> new ArrayList<>()).add(version);
    return lines;
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }
}
