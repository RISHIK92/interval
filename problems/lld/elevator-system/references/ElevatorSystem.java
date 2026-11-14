import java.util.*;

public class ElevatorSystem {
  private final long top;
  private final long[] at;
  private final List<TreeSet<Long>> stops = new ArrayList<>();
  // The extension round: elevators out of service.
  private final boolean[] out;

  public ElevatorSystem(long elevators, long floors) {
    if (elevators < 1 || floors < 1) throw new IllegalArgumentException("need an elevator and a floor");
    top = floors;
    at = new long[(int) elevators];
    out = new boolean[(int) elevators];
    for (int i = 0; i < elevators; i++) stops.add(new TreeSet<>());
  }

  private int elevator(long e) {
    if (e < 0 || e >= at.length) throw new IllegalArgumentException("unknown elevator");
    return (int) e;
  }

  private void floor(long f) {
    if (f < 0 || f > top) throw new IllegalArgumentException("unknown floor");
  }

  private long target(int i) {
    long best = 0;
    boolean any = false;
    for (long s : stops.get(i)) {
      long d = Math.abs(s - at[i]);
      long bd = Math.abs(best - at[i]);
      if (!any || d < bd || (d == bd && s < best)) {
        best = s;
        any = true;
      }
    }
    return best;
  }

  private int dispatch(long floor) {
    int best = -1;
    long bestCost = Long.MAX_VALUE;
    for (int i = 0; i < at.length; i++) {
      if (out[i]) continue;
      if (stops.get(i).contains(floor)) return i;
      long cost = Math.abs(at[i] - floor) + stops.get(i).size();
      if (cost < bestCost) {
        best = i;
        bestCost = cost;
      }
    }
    stops.get(best).add(floor);
    return best;
  }

  public synchronized long request(long floor) {
    floor(floor);
    return dispatch(floor);
  }

  public synchronized boolean press(long elevator, long floor) {
    int i = elevator(elevator);
    floor(floor);
    if (out[i]) throw new IllegalStateException("out of service");
    return stops.get(i).add(floor);
  }

  public synchronized List<String> step() {
    List<String> opened = new ArrayList<>();
    for (int i = 0; i < at.length; i++) {
      if (stops.get(i).isEmpty()) continue;
      long target = target(i);
      at[i] += Long.signum(target - at[i]);
      if (stops.get(i).remove(at[i])) opened.add(i + ":" + at[i]);
    }
    return opened;
  }

  public synchronized String status(long elevator) {
    int i = elevator(elevator);
    long here = at[i];
    if (out[i]) return here + " out -";
    if (stops.get(i).isEmpty()) return here + " idle -";
    long target = target(i);
    String state = target == here ? "here" : target > here ? "up" : "down";
    StringJoiner list = new StringJoiner(",");
    for (long s : stops.get(i)) list.add(Long.toString(s));
    return here + " " + state + " " + list;
  }

  public synchronized boolean outOfService(long elevator) {
    int i = elevator(elevator);
    if (out[i]) return false;
    int live = 0;
    for (boolean o : out) if (!o) live++;
    if (live == 1) throw new IllegalStateException("last elevator in service");
    out[i] = true;
    List<Long> pending = new ArrayList<>(stops.get(i));
    stops.get(i).clear();
    for (long floor : pending) dispatch(floor);
    return true;
  }
}
