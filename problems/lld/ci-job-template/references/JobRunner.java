import java.util.*;
import java.util.function.Supplier;

// Runs CI jobs of every kind through the one template, with the steps skipped and the
// commands to run before each step shared by all kinds.
public class JobRunner {
  private static final List<String> STEPS = List.of("checkout", "setup", "install", "test", "report");
  private static final Set<String> HOOKS = Set.of("setup", "install");

  // The template: run() fixes the skeleton and its rules (skipped hooks, stopping at a
  // failure, report always running), and each kind fills in only its own commands.
  // setup and install are hooks: a kind that doesn't override one has no such step.
  private abstract static class Job {
    String checkout() {
      return "git checkout";
    }

    String setup() {
      return null;
    }

    String install() {
      return null;
    }

    abstract String test();

    String report() {
      return "publish results";
    }

    final List<String> run(Set<String> skipped, String failAt, List<String> before) {
      List<String> commands = Arrays.asList(checkout(), setup(), install(), test(), report());
      List<String> log = new ArrayList<>();
      boolean failed = false;
      for (int i = 0; i < STEPS.size(); i++) {
        String step = STEPS.get(i);
        String command = commands.get(i);
        if (command == null || skipped.contains(step) || (failed && !step.equals("report"))) continue;
        for (String hook : before) log.add("before " + step + ": " + hook);
        if (step.equals(failAt)) {
          failed = true;
          command += " [failed]";
        }
        log.add(step + ": " + command);
      }
      return log;
    }
  }

  private static final class NodeJob extends Job {
    String setup() {
      return "nvm use";
    }

    String install() {
      return "npm ci";
    }

    String test() {
      return "npm test";
    }
  }

  private static final class PythonJob extends Job {
    String setup() {
      return "python -m venv .venv";
    }

    String install() {
      return "pip install -r requirements.txt";
    }

    String test() {
      return "pytest";
    }
  }

  private static final class GoJob extends Job {
    String install() {
      return "go mod download";
    }

    String test() {
      return "go test ./...";
    }
  }

  private static final Map<String, Supplier<Job>> KINDS =
      Map.of("node", NodeJob::new, "python", PythonJob::new, "go", GoJob::new);

  private final Set<String> skipped = new HashSet<>();
  private final List<String> before = new ArrayList<>();

  public List<String> steps(String kind) {
    return job(kind).run(skipped, "", before);
  }

  public void skip(String step) {
    if (!HOOKS.contains(step)) throw new IllegalArgumentException("only a hook can be skipped");
    skipped.add(step);
  }

  public List<String> runJob(String kind, String failAt) {
    Job found = job(kind);
    if (!failAt.isEmpty() && !STEPS.contains(failAt)) throw new IllegalArgumentException("unknown step");
    return found.run(skipped, failAt, before);
  }

  // The extension round: a command before every step.
  public void beforeEach(String command) {
    if (command.isEmpty()) throw new IllegalArgumentException("empty command");
    before.add(command);
  }

  private static Job job(String kind) {
    Supplier<Job> make = KINDS.get(kind);
    if (make == null) throw new IllegalArgumentException("unknown kind");
    return make.get();
  }
}
