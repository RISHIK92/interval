import java.util.*;

// The pipeline owns stages, a stage owns its jobs (composition); a job only names the
// jobs it needs (dependency), all in earlier stages, so a run goes in stage order.
public class Pipeline {
  private final List<String> stages = new ArrayList<>();
  private final Map<String, List<String>> jobs = new HashMap<>();
  private final Map<String, String> stageOf = new HashMap<>();
  private final Map<String, List<String>> needs = new HashMap<>();
  private final Set<String> failing = new HashSet<>();
  private final Set<String> allowed = new HashSet<>();

  public Pipeline() {}

  private static void named(String name) {
    if (name.isEmpty()) throw new IllegalArgumentException("stage and job names are not empty");
  }

  private void known(String job) {
    named(job);
    if (!stageOf.containsKey(job)) throw new IllegalArgumentException("unknown job");
  }

  public void stage(String name) {
    named(name);
    if (jobs.containsKey(name)) throw new IllegalArgumentException("stage already exists");
    stages.add(name);
    jobs.put(name, new ArrayList<>());
  }

  public boolean job(String stage, String name, List<String> needs) {
    named(stage);
    named(name);
    for (String n : needs) named(n);
    if (!jobs.containsKey(stage)) throw new IllegalArgumentException("unknown stage");
    if (new HashSet<>(needs).size() != needs.size()) throw new IllegalArgumentException("a need is listed twice");
    if (stageOf.containsKey(name)) return false;
    List<String> earlier = stages.subList(0, stages.indexOf(stage));
    for (String n : needs) if (!earlier.contains(stageOf.get(n))) return false;
    jobs.get(stage).add(name);
    stageOf.put(name, stage);
    this.needs.put(name, new ArrayList<>(needs));
    return true;
  }

  public void fail(String job) {
    known(job);
    failing.add(job);
  }

  private boolean blocks(String need, String result) {
    return result.equals("skipped") || (result.equals("failed") && !allowed.contains(need));
  }

  public List<String> run() {
    Map<String, String> outcome = new HashMap<>();
    List<String> out = new ArrayList<>();
    for (String stage : stages)
      for (String job : jobs.get(stage)) {
        String result = failing.contains(job) ? "failed" : "passed";
        for (String n : needs.get(job)) if (blocks(n, outcome.get(n))) result = "skipped";
        outcome.put(job, result);
        out.add(job + ": " + result);
      }
    return out;
  }

  public long removeStage(String name) {
    named(name);
    List<String> owned = jobs.get(name);
    if (owned == null) throw new IllegalArgumentException("unknown stage");
    for (Map.Entry<String, List<String>> e : needs.entrySet())
      if (!owned.contains(e.getKey()))
        for (String n : e.getValue())
          if (owned.contains(n)) throw new IllegalArgumentException("a later job needs this stage");
    for (String job : owned) {
      stageOf.remove(job);
      needs.remove(job);
      failing.remove(job);
      allowed.remove(job);
    }
    stages.remove(name);
    jobs.remove(name);
    return owned.size();
  }

  // The extension round: an allowed failure doesn't skip the jobs that need it.
  public void allowFailure(String job) {
    known(job);
    allowed.add(job);
  }
}
