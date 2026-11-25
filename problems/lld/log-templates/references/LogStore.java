import java.util.*;
import java.util.regex.Pattern;

public class LogStore {
  private static final String HOLE = "{}";

  // The flyweight: a message pattern split once into its literal parts. It holds nothing
  // about any one event, so every event with this pattern shares it.
  private static final class Template {
    private final String[] parts;

    Template(String pattern) {
      this.parts = pattern.split(Pattern.quote(HOLE), -1);
    }

    int holes() {
      return parts.length - 1;
    }

    String render(List<String> params) {
      StringBuilder out = new StringBuilder(parts[0]);
      for (int i = 0; i < params.size(); i++) out.append(params.get(i)).append(parts[i + 1]);
      return out.toString();
    }
  }

  private record LogEvent(Template template, List<String> params) {}

  // Events keep only their own parameters and a reference to their template.
  private final Map<String, Template> byText = new HashMap<>();
  private final Map<Long, LogEvent> events = new HashMap<>();
  private final Map<String, List<Long>> ids = new HashMap<>();
  private long last = 0;

  public long log(String pattern, List<String> params) {
    if (pattern.isEmpty() || params.contains("")) throw new IllegalArgumentException("an empty pattern or parameter");
    Template template = byText.get(pattern);
    if (template == null) template = new Template(pattern);
    if (template.holes() != params.size()) throw new IllegalArgumentException("one parameter per {}");
    byText.put(pattern, template);
    last++;
    events.put(last, new LogEvent(template, List.copyOf(params)));
    ids.computeIfAbsent(pattern, p -> new ArrayList<>()).add(last);
    return last;
  }

  public String render(long eventId) {
    LogEvent event = events.get(eventId);
    if (event == null) throw new NoSuchElementException("unknown event");
    return event.template().render(event.params());
  }

  public long templates() {
    return byText.size();
  }

  public List<Long> byPattern(String pattern) {
    if (pattern.isEmpty()) throw new IllegalArgumentException("an empty pattern");
    return new ArrayList<>(ids.getOrDefault(pattern, List.of()));
  }

  // The extension round: a pattern goes, and with it every event that shared it.
  public long purge(String pattern) {
    if (pattern.isEmpty()) throw new IllegalArgumentException("an empty pattern");
    List<Long> gone = ids.getOrDefault(pattern, List.of());
    byText.remove(pattern);
    ids.remove(pattern);
    for (Long id : gone) events.remove(id);
    return gone.size();
  }
}
