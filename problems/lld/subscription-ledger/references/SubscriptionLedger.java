import java.util.*;
import java.util.function.BiFunction;

public class SubscriptionLedger {
  private static final long MAX_TIER = 100;
  private static final long MAX_PAUSE_MS = 1_000_000_000L;
  private static final long MAX_MS = 1_000_000_000_000L;
  private static final long MAX_EVERY = 10_000;

  // A subscription at one moment. Immutable, so a snapshot (a memento) is just a
  // reference to one; null stands for a subscription not created yet.
  private record State(String status, long tier, long pausedUntil) {}

  private static String shown(State state, long now) {
    if (state == null) return "none";
    if (state.status().equals("active") && now < state.pausedUntil()) return "paused:" + state.tier();
    return state.status() + ":" + state.tier();
  }

  private record Event(long at, String name, long arg) {}

  private static State present(State s) {
    if (s == null) throw new IllegalStateException("only created comes first");
    return s;
  }

  // What each event does to a state, by its kind.
  private static final Map<String, BiFunction<State, Event, State>> APPLY = Map.of(
      "created", (s, e) -> new State("active", e.arg(), e.at()),
      "upgraded", (s, e) -> new State(present(s).status(), e.arg(), s.pausedUntil()),
      "paused", (s, e) -> new State(present(s).status(), s.tier(), e.at() + e.arg()),
      "cancelled", (s, e) -> new State("cancelled", present(s).tier(), s.pausedUntil()));

  private static boolean running(State s, long now) {
    return shown(s, now).startsWith("active:");
  }

  private interface Rule {
    boolean allowed(State s, long arg, long now);
  }

  // A request: its argument's range, and the rule it's checked by against the current
  // state. If it's allowed, it becomes an event of `kind`.
  private record Command(String kind, long low, long high, Rule rule) {
    boolean valid(long arg) {
      return low <= arg && arg <= high;
    }
  }

  private static final Map<String, Command> COMMANDS = Map.of(
      "create", new Command("created", 1, MAX_TIER, (s, arg, now) -> s == null),
      "upgrade", new Command("upgraded", 1, MAX_TIER, (s, arg, now) -> running(s, now) && s != null && arg > s.tier()),
      "pause", new Command("paused", 1, MAX_PAUSE_MS, (s, arg, now) -> running(s, now)),
      "cancel", new Command("cancelled", 0, 0, (s, arg, now) -> s != null && s.status().equals("active")));

  private record Snapshot(int count, State state) {}

  // One subscription's events, its current state, and snapshots.
  private static final class Stream {
    final List<Event> events = new ArrayList<>();
    State current = null;
    final List<Snapshot> snapshots = new ArrayList<>();
  }

  private final Map<String, Stream> streams = new HashMap<>();
  private Integer every = null;
  private long replayed = 0;
  private long last = 0;
  // An upcaster: an old event name and the newer name it's read under.
  private final Map<String, String> renamed = new HashMap<>();
  private final Map<String, String> kinds = new HashMap<>(); // current name -> kind

  public SubscriptionLedger() {
    for (String kind : APPLY.keySet()) kinds.put(kind, kind);
  }

  public boolean handle(String command, String sub, long arg, long nowMs) {
    Command found = COMMANDS.get(command);
    if (found == null || sub.isEmpty() || !found.valid(arg))
      throw new IllegalArgumentException("an unknown command, an empty sub or a bad arg");
    if (nowMs < last || nowMs > MAX_MS) throw new IllegalArgumentException("time runs forward, up to 10^12");
    last = nowMs;
    Stream stream = streams.computeIfAbsent(sub, k -> new Stream());
    if (!found.rule().allowed(stream.current, arg, nowMs)) return false;
    Event event = new Event(nowMs, nameOf(found.kind()), arg);
    stream.events.add(event);
    State state = APPLY.get(found.kind()).apply(stream.current, event);
    stream.current = state;
    if (every != null && stream.events.size() % every == 0)
      stream.snapshots.add(new Snapshot(stream.events.size(), state));
    return true;
  }

  public List<String> events(String sub) {
    List<String> out = new ArrayList<>();
    for (Event e : stream(sub).events) out.add(e.at() + ":" + read(e.name()) + ":" + e.arg());
    return out;
  }

  public String stateAt(String sub, long nowMs) {
    Stream stream = stream(sub);
    if (nowMs < 0 || nowMs > MAX_MS) throw new IllegalArgumentException("a time runs from 0 to 10^12");
    int covered = 0;
    State state = null;
    for (Snapshot snapshot : stream.snapshots) {
      if (stream.events.get(snapshot.count() - 1).at() <= nowMs) {
        covered = snapshot.count();
        state = snapshot.state();
      }
    }
    for (Event event : stream.events.subList(covered, stream.events.size())) {
      if (event.at() > nowMs) break;
      state = APPLY.get(kinds.get(read(event.name()))).apply(state, event);
      replayed++;
    }
    return shown(state, nowMs);
  }

  public void snapshotEvery(long n) {
    if (n < 1 || n > MAX_EVERY) throw new IllegalArgumentException("n runs from 1 to 10^4");
    every = (int) n;
  }

  public long replays() {
    return replayed;
  }

  // The extension round: old events read under a new schema name.
  public void upcast(String eventName, String newName) {
    String kind = kinds.get(eventName);
    if (kind == null || !newName.matches("[A-Za-z0-9]+"))
      throw new IllegalArgumentException("not a current name, or a bad new name");
    if (kinds.containsKey(newName) || renamed.containsKey(newName))
      throw new IllegalArgumentException("a name is never used twice");
    renamed.put(eventName, newName);
    kinds.remove(eventName);
    kinds.put(newName, kind);
  }

  private String nameOf(String kind) {
    for (Map.Entry<String, String> e : kinds.entrySet())
      if (e.getValue().equals(kind)) return e.getKey();
    throw new IllegalStateException("every kind has a name");
  }

  private String read(String name) {
    // Each name is renamed at most once and never reused, so this ends.
    String current = name;
    for (int i = 0; i < renamed.size(); i++) current = renamed.getOrDefault(current, current);
    return current;
  }

  private Stream stream(String sub) {
    if (sub.isEmpty()) throw new IllegalArgumentException("an empty sub");
    return streams.getOrDefault(sub, new Stream());
  }
}
