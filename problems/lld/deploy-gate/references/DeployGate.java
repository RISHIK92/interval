import java.util.*;

// Callers tell the gate what happened and ask it one question, "may I deploy?". Which
// checks are required, what they last reported and which are waived stay inside.
public class DeployGate {
  private final Set<String> required = new TreeSet<>();
  private final Map<String, Boolean> passed = new HashMap<>(); // each check's latest report
  private final TreeMap<String, String> waived = new TreeMap<>(); // check -> reason

  public DeployGate() {}

  private static void named(String name) {
    if (name.isEmpty()) throw new IllegalArgumentException("check names are not empty");
  }

  public void require(String check) {
    named(check);
    required.add(check);
  }

  public void report(String check, boolean passed) {
    named(check);
    this.passed.put(check, passed);
  }

  private boolean blocks(String check) {
    return !waived.containsKey(check) && !passed.getOrDefault(check, false);
  }

  public boolean mayDeploy() {
    for (String c : required) if (blocks(c)) return false;
    return true;
  }

  public List<String> blockers() {
    List<String> out = new ArrayList<>();
    for (String c : required) if (blocks(c)) out.add(c);
    return out;
  }

  // The extension round: a waived check never blocks.
  public void waive(String check, String reason) {
    named(check);
    if (reason.isEmpty()) throw new IllegalArgumentException("a waiver has a reason");
    if (!required.contains(check)) throw new IllegalArgumentException("only a required check is waived");
    waived.put(check, reason);
  }

  public List<String> waivers() {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, String> e : waived.entrySet()) out.add(e.getKey() + ": " + e.getValue());
    return out;
  }
}
