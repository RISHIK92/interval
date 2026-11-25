import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Changelog {
  // Parsing, grouping and rendering are three units with one reason to change each: a new
  // message syntax touches only the parser, a new section only the grouper, a new layout
  // only the renderer. Changelog just keeps the commits and wires the three together.

  private record Entry(String sha, String kind, String scope, boolean breaking, String description) {}

  private static final class Parser {
    private static final Pattern HEADER = Pattern.compile("([a-z]+)(?:\\(([^()]+)\\))?(!?): (.+)");

    static Optional<Entry> parse(String sha, String message) {
      Matcher found = HEADER.matcher(message);
      if (!found.matches()) return Optional.empty();
      return Optional.of(
          new Entry(sha, found.group(1), found.group(2), found.group(3).equals("!"), found.group(4)));
    }
  }

  private static final class Grouper {
    private static final Map<String, String> SECTIONS = Map.of("feat", "Features", "fix", "Fixes");
    private static final String OTHER = "Other";

    static LinkedHashMap<String, List<Entry>> group(List<Entry> entries, boolean breakingFirst) {
      LinkedHashMap<String, List<Entry>> sections = new LinkedHashMap<>();
      if (breakingFirst) sections.put("BREAKING", new ArrayList<>());
      for (String title : List.of("Features", "Fixes", OTHER)) sections.put(title, new ArrayList<>());
      for (Entry entry : entries) {
        String title =
            breakingFirst && entry.breaking() ? "BREAKING" : SECTIONS.getOrDefault(entry.kind(), OTHER);
        sections.get(title).add(entry);
      }
      sections.values().removeIf(List::isEmpty);
      return sections;
    }
  }

  private static final class Renderer {
    static List<String> render(String version, Map<String, List<Entry>> sections) {
      List<String> lines = new ArrayList<>(List.of("## " + version));
      sections.forEach(
          (title, entries) -> {
            lines.add("### " + title);
            for (Entry entry : entries) {
              String scope = entry.scope() == null ? "" : entry.scope() + ": ";
              String sha = entry.sha().substring(0, Math.min(7, entry.sha().length()));
              lines.add("- " + scope + entry.description() + " (" + sha + ")");
            }
          });
      return lines;
    }
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private List<Entry> pending = new ArrayList<>();
  private final Set<String> shas = new HashSet<>();
  private final Set<String> versions = new HashSet<>();
  private boolean breakingFirst = false;

  public Changelog() {}

  public boolean commit(String sha, String message) {
    given(sha);
    given(message);
    Optional<Entry> entry = Parser.parse(sha, message);
    if (entry.isEmpty() || shas.contains(sha)) return false;
    shas.add(sha);
    pending.add(entry.get());
    return true;
  }

  public List<String> release(String version) {
    given(version);
    if (versions.contains(version)) throw new IllegalArgumentException("already released");
    if (pending.isEmpty()) throw new IllegalArgumentException("nothing to release");
    List<String> lines = Renderer.render(version, Grouper.group(pending, breakingFirst));
    versions.add(version);
    pending = new ArrayList<>();
    return lines;
  }

  public long unreleased() {
    return pending.size();
  }

  // The extension round: one more grouping rule, and only the grouper hears about it.
  public void breakingSection(boolean on) {
    breakingFirst = on;
  }
}
