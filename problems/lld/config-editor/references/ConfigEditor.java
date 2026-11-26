import java.util.*;
import java.util.function.BiFunction;

// Every change is a command kept on a history, so undo and redo never need to know
// which kind of edit they're reversing.
public class ConfigEditor {
  private interface Command {
    void apply(Map<String, String> config);

    void undo(Map<String, String> config);
  }

  // A command: one edit to one key. Doing it remembers the key's value before, so
  // undoing it is the same for every kind of edit.
  private abstract static class Edit implements Command {
    final String key;
    final String val;
    private String before = null;

    Edit(String key, String val) {
      this.key = key;
      this.val = val;
    }

    abstract boolean refused(Map<String, String> config);

    abstract void change(Map<String, String> config);

    public void apply(Map<String, String> config) {
      before = config.get(key);
      change(config);
    }

    public void undo(Map<String, String> config) {
      if (before == null) config.remove(key);
      else config.put(key, before);
    }
  }

  private static final class Put extends Edit {
    Put(String key, String val) {
      super(key, val);
    }

    boolean refused(Map<String, String> config) {
      return val.equals(config.get(key));
    }

    void change(Map<String, String> config) {
      config.put(key, val);
    }
  }

  private static final class Remove extends Edit {
    Remove(String key, String val) {
      super(key, val);
    }

    boolean refused(Map<String, String> config) {
      return !config.containsKey(key);
    }

    void change(Map<String, String> config) {
      config.remove(key);
    }
  }

  private static final class Append extends Edit {
    Append(String key, String val) {
      super(key, val);
    }

    boolean refused(Map<String, String> config) {
      return !config.containsKey(key) || val.isEmpty();
    }

    void change(Map<String, String> config) {
      config.put(key, config.get(key) + val);
    }
  }

  // Several edits done and undone as one command: undone in reverse order.
  private static final class Batch implements Command {
    private final List<Edit> edits;

    Batch(List<Edit> edits) {
      this.edits = edits;
    }

    public void apply(Map<String, String> config) {
      for (Edit edit : edits) edit.apply(config);
    }

    public void undo(Map<String, String> config) {
      for (int i = edits.size() - 1; i >= 0; i--) edits.get(i).undo(config);
    }
  }

  private static final Map<String, BiFunction<String, String, Edit>> OPS =
      Map.of("put", Put::new, "remove", Remove::new, "append", Append::new);

  private final Map<String, String> config = new HashMap<>();
  private final Deque<Command> done = new ArrayDeque<>();
  private final Deque<Command> undone = new ArrayDeque<>();

  public boolean apply(String op, String key, String val) {
    Edit edit = edit(op, key, val);
    if (edit.refused(config)) return false;
    edit.apply(config);
    record(edit);
    return true;
  }

  public boolean undo() {
    Command command = done.pollFirst();
    if (command == null) return false;
    command.undo(config);
    undone.addFirst(command);
    return true;
  }

  public boolean redo() {
    Command command = undone.pollFirst();
    if (command == null) return false;
    command.apply(config);
    done.addFirst(command);
    return true;
  }

  public Map<String, String> view() {
    return new HashMap<>(config);
  }

  // The extension round: several edits as one command.
  public boolean batch(List<String> ops) {
    List<Edit> edits = new ArrayList<>();
    for (String entry : ops) {
      String[] fields = entry.split(" ", 3);
      if (fields.length != 3) throw new IllegalArgumentException("not <op> <key> <val>");
      edits.add(edit(fields[0], fields[1], fields[2]));
    }
    List<Edit> applied = new ArrayList<>();
    for (Edit edit : edits) {
      if (edit.refused(config)) continue;
      edit.apply(config);
      applied.add(edit);
    }
    if (applied.isEmpty()) return false;
    record(new Batch(applied));
    return true;
  }

  private static Edit edit(String op, String key, String val) {
    BiFunction<String, String, Edit> kind = OPS.get(op);
    if (kind == null || key.isEmpty())
      throw new IllegalArgumentException("unknown op or empty key");
    return kind.apply(key, val);
  }

  private void record(Command command) {
    done.addFirst(command);
    undone.clear();
  }
}
