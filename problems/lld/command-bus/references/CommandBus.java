import java.util.*;

public class CommandBus {
  private static final long MAX_REPLICAS = 1000;

  private static final class Service {
    long replicas = 0;
    boolean paused = false;
  }

  // A command object: it knows how to run itself and how to take itself back. Running
  // reports whether anything changed: a command that changed nothing has nothing to undo.
  private interface Command {
    String service();

    boolean run(Service service);

    void undo(Service service);
  }

  private static final class Scale implements Command {
    private final String name;
    private final long target;
    private long before = 0;

    Scale(String name, long target) {
      this.name = name;
      this.target = target;
    }

    public String service() {
      return name;
    }

    public boolean run(Service service) {
      before = service.replicas;
      service.replicas = target;
      return before != target;
    }

    public void undo(Service service) {
      service.replicas = before;
    }
  }

  private static final class Pause implements Command {
    private final String name;

    Pause(String name) {
      this.name = name;
    }

    public String service() {
      return name;
    }

    public boolean run(Service service) {
      boolean changed = !service.paused;
      service.paused = true;
      return changed;
    }

    public void undo(Service service) {
      service.paused = false;
    }
  }

  private static final class Resume implements Command {
    private final String name;

    Resume(String name) {
      this.name = name;
    }

    public String service() {
      return name;
    }

    public boolean run(Service service) {
      boolean changed = service.paused;
      service.paused = false;
      return changed;
    }

    public void undo(Service service) {
      service.paused = true;
    }
  }

  private static boolean isCount(String text) {
    if (text.isEmpty() || text.length() > 4 || (text.length() > 1 && text.charAt(0) == '0')) return false;
    for (char c : text.toCharArray()) if (c < '0' || c > '9') return false;
    return Long.parseLong(text) <= MAX_REPLICAS;
  }

  private static Command parse(String command, String arg) {
    if (command.equals("scale")) {
      int at = arg.indexOf('=');
      String name = at < 0 ? "" : arg.substring(0, at);
      String count = at < 0 ? "" : arg.substring(at + 1);
      if (name.isEmpty() || !isCount(count))
        throw new IllegalArgumentException("scale takes <service>=<0 to 1000>");
      return new Scale(name, Long.parseLong(count));
    }
    if (arg.isEmpty() || arg.contains("=")) throw new IllegalArgumentException("a service name");
    if (command.equals("pause")) return new Pause(arg);
    if (command.equals("resume")) return new Resume(arg);
    throw new IllegalArgumentException("unknown command");
  }

  private static final class Entry {
    final String id;
    final String line;
    final Command command;
    final long atMs;
    Service target;

    Entry(String id, String line, Command command, long atMs) {
      this.id = id;
      this.line = line;
      this.command = command;
      this.atMs = atMs;
    }
  }

  private final Map<String, Service> services = new HashMap<>();
  private final Set<String> ids = new HashSet<>();
  private List<Entry> queue = new ArrayList<>();
  private List<Entry> scheduled = new ArrayList<>();
  private final Deque<Entry> done = new ArrayDeque<>();
  private final List<String> history = new ArrayList<>();

  public CommandBus() {}

  private Entry accept(String id, String command, String arg, long atMs) {
    if (id.isEmpty()) throw new IllegalArgumentException("an empty id");
    Command parsed = parse(command, arg);
    if (!ids.add(id)) return null;
    return new Entry(id, command + " " + arg, parsed, atMs);
  }

  private String run(Entry entry) {
    Service service = services.computeIfAbsent(entry.command.service(), s -> new Service());
    String line = entry.id + ": skipped";
    if (entry.command.run(service)) {
      entry.target = service;
      done.push(entry);
      line = entry.id + ": " + entry.line;
    }
    history.add(line);
    return line;
  }

  public boolean submit(String id, String command, String arg) {
    Entry entry = accept(id, command, arg, 0);
    if (entry == null) return false;
    queue.add(entry);
    return true;
  }

  public List<String> execute() {
    List<Entry> ran = queue;
    queue = new ArrayList<>();
    List<String> lines = new ArrayList<>();
    for (Entry entry : ran) lines.add(run(entry));
    return lines;
  }

  public String undoLast() {
    Entry entry = done.poll();
    if (entry == null) return null;
    entry.command.undo(entry.target);
    history.add(entry.id + ": undone");
    return entry.id;
  }

  public long replicas(String service) {
    if (service.isEmpty()) throw new IllegalArgumentException("an empty service");
    Service found = services.get(service);
    return found == null || found.paused ? 0 : found.replicas;
  }

  public List<String> log() {
    return new ArrayList<>(history);
  }

  // The extension round: commands that wait for their time, sharing the ids and the undo
  // stack.
  public boolean schedule(String id, String command, String arg, long atMs) {
    if (atMs < 0) throw new IllegalArgumentException("a negative time");
    Entry entry = accept(id, command, arg, atMs);
    if (entry == null) return false;
    scheduled.add(entry);
    return true;
  }

  public List<String> executeDue(long nowMs) {
    if (nowMs < 0) throw new IllegalArgumentException("a negative time");
    List<Entry> due = new ArrayList<>();
    List<Entry> later = new ArrayList<>();
    for (Entry entry : scheduled) (entry.atMs <= nowMs ? due : later).add(entry);
    scheduled = later;
    // A stable sort: commands due at the same time run in the order they were scheduled.
    due.sort(Comparator.comparingLong(e -> e.atMs));
    List<String> lines = new ArrayList<>();
    for (Entry entry : due) lines.add(run(entry));
    return lines;
  }
}
