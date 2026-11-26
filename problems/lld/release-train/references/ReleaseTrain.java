import java.util.*;

public class ReleaseTrain {
  private static final List<String> ROLES = List.of("qa", "security");

  // A colleague: it knows its own changes and sign-offs, never the other trains.
  private static final class Train {
    final String name;
    final List<String> needs;
    final LinkedHashMap<String, String> changes = new LinkedHashMap<>(); // change -> team
    final Set<String> signed = new HashSet<>();
    boolean departed = false;

    Train(String name, List<String> needs) {
      this.name = name;
      this.needs = needs;
    }

    boolean ready() {
      return signed.containsAll(needs);
    }

    void take(String change, String team) {
      changes.put(change, team);
      signed.clear();
    }

    String drop(String change) {
      signed.clear();
      return changes.remove(change);
    }
  }

  // The mediator: teams, reviewers and trains only talk to it, and it keeps the rule that
  // any change to a train's contents voids its sign-offs.
  private final List<Train> trains = new ArrayList<>();
  private final Map<String, Train> aboard = new HashMap<>();
  private final Set<String> departed = new HashSet<>();

  public ReleaseTrain() {}

  public String board(String team, String change) {
    if (team.isEmpty() || change.isEmpty()) throw new IllegalArgumentException("empty name");
    if (aboard.containsKey(change) || departed.contains(change))
      throw new IllegalArgumentException("the change has boarded");
    Train train = trains.stream().filter(this::boarding).findFirst().orElseGet(() -> newTrain(ROLES));
    train.take(change, team);
    aboard.put(change, train);
    return train.name;
  }

  public boolean signOff(String role, String train) {
    if (!ROLES.contains(role)) throw new IllegalArgumentException("unknown role");
    Train t = find(train);
    if (t.departed || t.changes.isEmpty() || !t.needs.contains(role) || t.signed.contains(role))
      return false;
    t.signed.add(role);
    return true;
  }

  public boolean pull(String change) {
    if (change.isEmpty()) throw new IllegalArgumentException("empty change");
    Train train = aboard.remove(change);
    if (train == null) return false;
    train.drop(change);
    return true;
  }

  public List<String> depart(String train) {
    Train t = find(train);
    if (t.departed || !t.ready()) return List.of();
    t.departed = true;
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, String> e : t.changes.entrySet()) {
      aboard.remove(e.getKey());
      departed.add(e.getKey());
      out.add(e.getValue() + ":" + e.getKey());
    }
    return out;
  }

  // The extension round: a hotfix leaves its train and departs alone.
  public String hotfix(String change) {
    Train train = aboard.get(change);
    if (train == null || train.needs != ROLES)
      throw new IllegalArgumentException("not aboard a regular train");
    Train alone = newTrain(List.of("security"));
    alone.take(change, train.drop(change));
    aboard.put(change, alone);
    return alone.name;
  }

  private boolean boarding(Train t) {
    return !t.departed && t.needs == ROLES && !t.ready();
  }

  private Train newTrain(List<String> needs) {
    Train train = new Train("T" + (trains.size() + 1), needs);
    trains.add(train);
    return train;
  }

  private Train find(String name) {
    for (Train t : trains) if (t.name.equals(name)) return t;
    throw new IllegalArgumentException("unknown train");
  }
}
