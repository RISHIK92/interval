import java.util.*;

public class JobSpec {
  private static final class EnvValue {
    final String value;
    final boolean secret;

    EnvValue(String value, boolean secret) {
      this.value = value;
      this.secret = secret;
    }
  }

  private final String name;
  private final List<String> steps = new ArrayList<>();
  // Sorted by key.
  private final TreeMap<String, EnvValue> env = new TreeMap<>();

  public JobSpec(String name) {
    if (name.isEmpty()) throw new IllegalArgumentException("a job needs a name");
    this.name = name;
  }

  private static String checkedKey(String key) {
    if (!key.matches("[A-Z][A-Z0-9_]*")) throw new IllegalArgumentException("an env key is upper snake case");
    return key;
  }

  public long addStep(String command) {
    if (command.isEmpty()) throw new IllegalArgumentException("a step needs a command");
    steps.add(command);
    return steps.size();
  }

  public void setEnv(String key, String value) {
    env.put(checkedKey(key), new EnvValue(value, false));
  }

  public List<String> render() {
    List<String> lines = new ArrayList<>();
    lines.add("job " + name);
    for (Map.Entry<String, EnvValue> e : env.entrySet())
      lines.add("env " + e.getKey() + "=" + (e.getValue().secret ? "***" : e.getValue().value));
    for (int i = 0; i < steps.size(); i++) lines.add("step " + (i + 1) + ": " + steps.get(i));
    return lines;
  }

  public long stepCount() {
    return steps.size();
  }

  // The extension round.
  public void secret(String key, String value) {
    env.put(checkedKey(key), new EnvValue(value, true));
  }
}
