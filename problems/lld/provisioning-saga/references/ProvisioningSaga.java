import java.util.*;

public class ProvisioningSaga {
  private static final String FAILED = "fail:";
  private static final List<String> STEPS = List.of("create-user", "create-repo", "grant-access", "send-welcome");
  private static final long MAX_TIMES = 1000;

  // A command with its compensation. Each returns what it did, for the trail; an injected
  // failure count makes the next attempts fail.
  private static final class Step {
    final String name;
    long failures = 0;

    Step(String name) {
      this.name = name;
    }

    String execute() {
      if (failures == 0) return "do:" + name;
      failures--;
      return FAILED + name;
    }

    String compensate() {
      return "undo:" + name;
    }
  }

  // One account's run: the steps done, in order, and everything that happened.
  private static final class Saga {
    final List<Step> done = new ArrayList<>();
    final List<String> trail = new ArrayList<>();
    String status = "";

    void resume(List<Step> steps, Step pivot) {
      // Done steps are skipped, so a retry carries on where the last run stopped and a
      // completed saga runs nothing.
      for (Step step : steps.subList(done.size(), steps.size())) {
        String entry = step.execute();
        trail.add(entry);
        if (entry.startsWith(FAILED)) {
          failed(pivot);
          return;
        }
        done.add(step);
      }
      status = "completed";
    }

    private void failed(Step pivot) {
      if (pivot != null && done.contains(pivot)) {
        status = "pending";
        return;
      }
      for (int i = done.size() - 1; i >= 0; i--) trail.add(done.get(i).compensate());
      done.clear();
      status = "compensated";
    }
  }

  private final List<Step> steps = new ArrayList<>();
  private final Map<String, Saga> sagas = new HashMap<>();
  private Step pivotStep = null;

  public ProvisioningSaga() {
    for (String name : STEPS) steps.add(new Step(name));
  }

  public void failStep(String step, long times) {
    Step found = findStep(step);
    if (times < 0 || times > MAX_TIMES) throw new IllegalArgumentException("times runs from 0 to 1000");
    found.failures = times;
  }

  public String start(String account) {
    if (account.isEmpty()) throw new IllegalArgumentException("an empty account");
    Saga saga = sagas.get(account);
    if (saga == null) {
      saga = new Saga();
      sagas.put(account, saga);
      saga.resume(steps, pivotStep);
    }
    return saga.status;
  }

  public String retry(String account) {
    Saga saga = findSaga(account);
    saga.resume(steps, pivotStep);
    return saga.status;
  }

  public List<String> trail(String account) {
    return new ArrayList<>(findSaga(account).trail);
  }

  public String status(String account) {
    return findSaga(account).status;
  }

  // The extension round: a pivot step, past which the saga only moves forward.
  public void pivot(String step) {
    pivotStep = findStep(step);
  }

  private Step findStep(String name) {
    for (Step step : steps)
      if (step.name.equals(name)) return step;
    throw new NoSuchElementException("no such step");
  }

  private Saga findSaga(String account) {
    Saga saga = sagas.get(account);
    if (saga == null) throw new NoSuchElementException("no such account");
    return saga;
  }
}
