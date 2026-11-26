import java.util.*;
import java.util.function.IntPredicate;

public class LogQuery {
  private static final String SOURCE = "logs";
  private static final int MAX_TOP = 10_000;
  private static final int MAX_DIGITS = 9;
  private static final Map<String, IntPredicate> OPS = Map.of(
      "=", c -> c == 0,
      "!=", c -> c != 0,
      "<", c -> c < 0,
      "<=", c -> c <= 0,
      ">", c -> c > 0,
      ">=", c -> c >= 0);

  private static String checkName(String text) {
    if (!text.matches("[A-Za-z0-9_.]+")) throw new IllegalArgumentException("a name is letters, digits, _ and .");
    return text;
  }

  private static Integer integer(String text) {
    String digits = text.startsWith("-") ? text.substring(1) : text;
    if (!digits.isEmpty() && digits.length() <= MAX_DIGITS && digits.chars().allMatch(c -> c >= '0' && c <= '9'))
      return Integer.parseInt(text);
    return null;
  }

  // One order for every stage: integers by value, before every other value, and other
  // values by character code.
  static int compare(String a, String b) {
    Integer x = integer(a), y = integer(b);
    if (x != null && y != null) return Integer.compare(x, y);
    if (x != null) return -1;
    if (y != null) return 1;
    return Integer.signum(a.compareTo(b));
  }

  interface Visitor<T> {
    T where(Where s);

    T count(Count s);

    T sort(Sort s);

    T top(Top s);
  }

  interface Stage {
    List<Map<String, String>> apply(List<Map<String, String>> rows);

    <T> T accept(Visitor<T> visitor);
  }

  record Where(String field, String op, String value) implements Stage {
    public List<Map<String, String>> apply(List<Map<String, String>> rows) {
      IntPredicate test = OPS.get(op);
      List<Map<String, String>> out = new ArrayList<>();
      for (Map<String, String> r : rows)
        if (r.containsKey(field) && test.test(compare(r.get(field), value))) out.add(r);
      return out;
    }

    public <T> T accept(Visitor<T> visitor) {
      return visitor.where(this);
    }
  }

  record Count(String field) implements Stage {
    public List<Map<String, String>> apply(List<Map<String, String>> rows) {
      Map<String, Integer> counts = new LinkedHashMap<>();
      for (Map<String, String> r : rows)
        if (r.containsKey(field)) counts.merge(r.get(field), 1, Integer::sum);
      List<Map<String, String>> out = new ArrayList<>();
      for (Map.Entry<String, Integer> e : counts.entrySet())
        out.add(Map.of(field, e.getKey(), "count", String.valueOf(e.getValue())));
      return out;
    }

    public <T> T accept(Visitor<T> visitor) {
      return visitor.count(this);
    }
  }

  record Sort(String field, boolean descending) implements Stage {
    public List<Map<String, String>> apply(List<Map<String, String>> rows) {
      int order = descending ? -1 : 1;
      List<Map<String, String>> having = new ArrayList<>(), without = new ArrayList<>();
      for (Map<String, String> r : rows) (r.containsKey(field) ? having : without).add(r);
      // List.sort is stable: equal rows keep their order.
      having.sort((a, b) -> order * compare(a.get(field), b.get(field)));
      having.addAll(without);
      return having;
    }

    public <T> T accept(Visitor<T> visitor) {
      return visitor.sort(this);
    }
  }

  record Top(int n) implements Stage {
    public List<Map<String, String>> apply(List<Map<String, String>> rows) {
      return rows.subList(0, Math.min(n, rows.size()));
    }

    public <T> T accept(Visitor<T> visitor) {
      return visitor.top(this);
    }
  }

  // A visitor: one line per stage, in a canonical spelling.
  static final class Explainer implements Visitor<String> {
    public String where(Where s) {
      return "where " + s.field() + " " + s.op() + " " + s.value();
    }

    public String count(Count s) {
      return "count " + s.field();
    }

    public String sort(Sort s) {
      return "sort " + s.field() + (s.descending() ? " desc" : " asc");
    }

    public String top(Top s) {
      return "top " + s.n();
    }
  }

  // The parsed query: a source and its stages.
  record Pipeline(String source, List<Stage> stages) {}

  private static Stage parseStage(List<String> words) {
    String kind = words.get(0);
    int n = words.size();
    if (kind.equals("where") && n == 4 && OPS.containsKey(words.get(2)))
      return new Where(checkName(words.get(1)), words.get(2), words.get(3));
    if (kind.equals("count") && n == 2 && !words.get(1).equals("count")) return new Count(checkName(words.get(1)));
    if (kind.equals("sort") && n == 2) return new Sort(checkName(words.get(1)), false);
    if (kind.equals("sort") && n == 3 && (words.get(2).equals("asc") || words.get(2).equals("desc")))
      return new Sort(checkName(words.get(1)), words.get(2).equals("desc"));
    if (kind.equals("top") && n == 2 && words.get(1).matches("[0-9]{1,5}")) {
      int top = Integer.parseInt(words.get(1));
      if (top >= 1 && top <= MAX_TOP) return new Top(top);
    }
    throw new IllegalArgumentException("not a stage");
  }

  private static Pipeline parse(String query) {
    List<List<String>> parts = new ArrayList<>();
    for (String part : query.split("\\|", -1)) {
      List<String> words = new ArrayList<>();
      for (String w : part.split(" ")) if (!w.isEmpty()) words.add(w);
      if (words.isEmpty()) throw new IllegalArgumentException("an empty part");
      parts.add(words);
    }
    if (parts.get(0).size() != 1) throw new IllegalArgumentException("a bad source");
    List<Stage> stages = new ArrayList<>();
    for (List<String> words : parts.subList(1, parts.size())) stages.add(parseStage(words));
    return new Pipeline(parts.get(0).get(0), stages);
  }

  private final List<Map<String, String>> records = new ArrayList<>();
  private final Map<String, Pipeline> views = new HashMap<>();

  public void ingest(Map<String, String> fields) {
    if (fields.isEmpty()) throw new IllegalArgumentException("an empty record");
    for (Map.Entry<String, String> e : fields.entrySet()) {
      checkName(e.getKey());
      if (e.getValue().isEmpty()) throw new IllegalArgumentException("an empty value");
    }
    records.add(new HashMap<>(fields));
  }

  public List<String> run(String query) {
    List<String> out = new ArrayList<>();
    for (Map<String, String> r : rows(checked(query))) {
      StringJoiner line = new StringJoiner(" ");
      for (Map.Entry<String, String> e : new TreeMap<>(r).entrySet()) line.add(e.getKey() + "=" + e.getValue());
      out.add(line.toString());
    }
    return out;
  }

  public List<String> explainQuery(String query) {
    return explain(checked(query));
  }

  // The extension round: saved views, usable as sources.
  public void saveView(String name, String query) {
    checkName(name);
    Pipeline pipeline = checked(query);
    if (name.equals(SOURCE) || views.containsKey(name)) throw new IllegalArgumentException("that source exists");
    views.put(name, pipeline);
  }

  private Pipeline checked(String query) {
    Pipeline pipeline = parse(query);
    if (!pipeline.source().equals(SOURCE) && !views.containsKey(pipeline.source()))
      throw new NoSuchElementException("no such source");
    return pipeline;
  }

  private List<Map<String, String>> rows(Pipeline pipeline) {
    Pipeline view = views.get(pipeline.source());
    List<Map<String, String>> rows = view == null ? records : rows(view);
    for (Stage stage : pipeline.stages()) rows = stage.apply(rows);
    return rows;
  }

  private List<String> explain(Pipeline pipeline) {
    Pipeline view = views.get(pipeline.source());
    List<String> lines = view == null ? new ArrayList<>(List.of("source " + SOURCE)) : explain(view);
    Explainer explainer = new Explainer();
    for (Stage stage : pipeline.stages()) lines.add(stage.accept(explainer));
    return lines;
  }
}
