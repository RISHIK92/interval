import java.util.*;
import java.util.regex.Pattern;

// Each source's entries are kept as given; only resolution knows the precedence.
public class LayeredConfig {
  // Lowest precedence first: a later source overrides an earlier one.
  private static final List<String> SOURCES = List.of("defaults", "file", "env", "flags");
  private static final Pattern INTEGER = Pattern.compile("-?[0-9]{1,15}");

  private final Map<String, Map<String, String>> layers = new HashMap<>();
  private final Map<String, String> renamed = new LinkedHashMap<>(); // old key -> new key

  public LayeredConfig() {
    for (String s : SOURCES) layers.put(s, new HashMap<>());
  }

  // Parsing is its own concern: lookup finds the text, this decides what it means.
  private static long parseInteger(String text) {
    if (!INTEGER.matcher(text).matches()) throw new NumberFormatException("not an integer");
    return Long.parseLong(text);
  }

  public void layer(String source, Map<String, String> entries) {
    if (!layers.containsKey(source)) throw new IllegalArgumentException("unknown source");
    if (entries.containsKey("")) throw new IllegalArgumentException("a key is not empty");
    layers.put(source, new HashMap<>(entries));
  }

  // The names a setting may be written under, the current one first.
  private List<String> names(String key) {
    if (key.isEmpty()) throw new IllegalArgumentException("a key is not empty");
    String current = renamed.getOrDefault(key, key);
    List<String> out = new ArrayList<>(List.of(current));
    for (Map.Entry<String, String> e : renamed.entrySet())
      if (e.getValue().equals(current)) out.add(e.getKey());
    return out;
  }

  // The winning source and its value, or null.
  private String[] winner(String key) {
    List<String> names = names(key);
    for (int i = SOURCES.size() - 1; i >= 0; i--) {
      Map<String, String> entries = layers.get(SOURCES.get(i));
      for (String name : names)
        if (entries.containsKey(name)) return new String[] {SOURCES.get(i), entries.get(name)};
    }
    return null;
  }

  public String lookup(String key) {
    String[] found = winner(key);
    return found == null ? null : found[1];
  }

  public String origin(String key) {
    String[] found = winner(key);
    return found == null ? null : found[0];
  }

  public Long intValue(String key) {
    String[] found = winner(key);
    return found == null ? null : parseInteger(found[1]);
  }

  // The extension round: a renamed setting answers to both names.
  public void alias(String oldKey, String newKey) {
    if (oldKey.isEmpty() || newKey.isEmpty() || oldKey.equals(newKey))
      throw new IllegalArgumentException("two different, non-empty keys");
    if (renamed.containsKey(oldKey) || renamed.containsValue(oldKey)
        || renamed.containsKey(newKey) || renamed.containsValue(newKey))
      throw new IllegalArgumentException("a key is in at most one alias");
    renamed.put(oldKey, newKey);
  }
}
