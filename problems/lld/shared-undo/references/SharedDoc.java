import java.util.*;

public class SharedDoc {
  private static void checkName(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("an empty name or value");
  }

  private static void checkUser(String user) {
    checkName(user);
    if (user.contains(":")) throw new IllegalArgumentException("a user name has no colon");
  }

  // A command that remembers the key's value before it ran (its memento), so it can be
  // undone and redone. `at` counts its key's writes up to the one that last applied it:
  // the edit, an undo or a redo.
  private static final class Edit {
    final String user;
    final String key;
    final String before;
    final String after;
    int at = 0;

    Edit(String user, String key, String before, String after) {
      this.user = user;
      this.key = key;
      this.before = before;
      this.after = after;
    }
  }

  private record Write(String user, String entry) {}

  private final Map<String, String> values = new HashMap<>();
  private final Map<String, List<Write>> writes = new HashMap<>();
  private final Map<String, Deque<Edit>> undos = new HashMap<>();
  private final Map<String, Deque<Edit>> redos = new HashMap<>();

  public void edit(String user, String key, String val) {
    checkUser(user);
    checkName(key);
    checkName(val);
    Edit command = new Edit(user, key, values.get(key), val);
    write(command, "edit", val);
    stack(undos, user).push(command);
    redos.put(user, new ArrayDeque<>());
  }

  public boolean undo(String user) {
    return undoLast(user, false);
  }

  public boolean redo(String user) {
    checkUser(user);
    Deque<Edit> stack = stack(redos, user);
    Edit command = stack.peek();
    if (command == null || conflicts(command)) return false;
    stack.pop();
    write(command, "redo", command.after);
    stack(undos, user).push(command);
    return true;
  }

  public String value(String key) {
    checkName(key);
    return values.get(key);
  }

  public List<String> history(String key) {
    checkName(key);
    List<String> out = new ArrayList<>();
    for (Write w : writes.getOrDefault(key, List.of())) out.add(w.entry());
    return out;
  }

  // The extension round: an undo that goes through despite a conflict.
  public boolean undoForce(String user) {
    return undoLast(user, true);
  }

  private boolean undoLast(String user, boolean force) {
    checkUser(user);
    Deque<Edit> stack = stack(undos, user);
    Edit command = stack.peek();
    if (command == null) return false;
    String action = "undo";
    if (conflicts(command)) {
      if (!force) return false;
      action = "force";
    }
    stack.pop();
    write(command, action, command.before);
    stack(redos, user).push(command);
    return true;
  }

  // Someone else wrote the key after the command last took effect.
  private boolean conflicts(Edit command) {
    List<Write> log = writes.get(command.key);
    for (Write w : log.subList(command.at, log.size()))
      if (!w.user().equals(command.user)) return true;
    return false;
  }

  private void write(Edit command, String action, String val) {
    if (val == null) values.remove(command.key);
    else values.put(command.key, val);
    List<Write> log = writes.computeIfAbsent(command.key, k -> new ArrayList<>());
    log.add(new Write(command.user, action + ":" + command.user + ":" + (val == null ? "" : val)));
    command.at = log.size();
  }

  private static Deque<Edit> stack(Map<String, Deque<Edit>> stacks, String user) {
    return stacks.computeIfAbsent(user, k -> new ArrayDeque<>());
  }
}
