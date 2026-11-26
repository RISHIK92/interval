import java.util.*;

public class AlertExpr {
  private static final List<String> KEYWORDS = List.of("and", "or", "not");
  private static final int MAX_DIGITS = 15;
  private static final List<String> OPS = List.of(">", ">=", "<", "<=", "==", "!=");

  private static final class Tally {
    long comparisons = 0;
  }

  // An expression in the language: a comparison, or not, and, or over expressions.
  private interface Node {
    boolean evaluate(Map<String, Long> metrics, Tally seen);

    long depth();

    void names(Set<String> out);

    void rename(String from, String to);

    String text();
  }

  private static final class Compare implements Node {
    private String metric;
    private final String op;
    private final long value;

    Compare(String metric, String op, long value) {
      this.metric = metric;
      this.op = op;
      this.value = value;
    }

    public boolean evaluate(Map<String, Long> metrics, Tally seen) {
      seen.comparisons += 1;
      Long current = metrics.get(metric);
      if (current == null) return false;
      return switch (op) {
        case ">" -> current > value;
        case ">=" -> current >= value;
        case "<" -> current < value;
        case "<=" -> current <= value;
        case "==" -> current == value;
        default -> current != value;
      };
    }

    public long depth() {
      return 1;
    }

    public void names(Set<String> out) {
      out.add(metric);
    }

    public void rename(String from, String to) {
      if (metric.equals(from)) metric = to;
    }

    public String text() {
      return metric + " " + op + " " + value;
    }
  }

  private record Not(Node inner) implements Node {
    public boolean evaluate(Map<String, Long> metrics, Tally seen) {
      return !inner.evaluate(metrics, seen);
    }

    public long depth() {
      return 1 + inner.depth();
    }

    public void names(Set<String> out) {
      inner.names(out);
    }

    public void rename(String from, String to) {
      inner.rename(from, to);
    }

    public String text() {
      return "not " + inner.text();
    }
  }

  private record Binary(String word, Node left, Node right) implements Node {
    public boolean evaluate(Map<String, Long> metrics, Tally seen) {
      return word.equals("and")
          ? left.evaluate(metrics, seen) && right.evaluate(metrics, seen)
          : left.evaluate(metrics, seen) || right.evaluate(metrics, seen);
    }

    public long depth() {
      return 1 + Math.max(left.depth(), right.depth());
    }

    public void names(Set<String> out) {
      left.names(out);
      right.names(out);
    }

    public void rename(String from, String to) {
      left.rename(from, to);
      right.rename(from, to);
    }

    public String text() {
      return "(" + left.text() + " " + word + " " + right.text() + ")";
    }
  }

  private record Token(String kind, String text) {}

  private static boolean isDigit(char c) {
    return c >= '0' && c <= '9';
  }

  private static boolean isLetter(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  }

  private static boolean isNameChar(char c) {
    return isLetter(c) || isDigit(c) || c == '_' || c == '.';
  }

  private static boolean isName(String s) {
    if (s.isEmpty() || !isLetter(s.charAt(0)) || KEYWORDS.contains(s)) return false;
    for (char c : s.toCharArray()) if (!isNameChar(c)) return false;
    return true;
  }

  private static List<Token> tokenize(String s) {
    List<Token> tokens = new ArrayList<>();
    for (int i = 0; i < s.length(); ) {
      char c = s.charAt(i);
      String two = s.substring(i, Math.min(i + 2, s.length()));
      int j = i + 1;
      if (c == ' ') {
        i = j;
        continue;
      }
      if (isDigit(c) || (c == '-' && j < s.length() && isDigit(s.charAt(j)))) {
        while (j < s.length() && isDigit(s.charAt(j))) j++;
        tokens.add(new Token("number", s.substring(i, j)));
      } else if (isLetter(c)) {
        while (j < s.length() && isNameChar(s.charAt(j))) j++;
        tokens.add(new Token("word", s.substring(i, j)));
      } else if (two.length() == 2 && OPS.contains(two)) {
        j = i + 2;
        tokens.add(new Token("symbol", two));
      } else if ("<>()".indexOf(c) >= 0) {
        tokens.add(new Token("symbol", String.valueOf(c)));
      } else throw new IllegalArgumentException("unexpected character");
      i = j;
    }
    return tokens;
  }

  // Recursive descent: each method parses one level of the grammar.
  private static final class Parser {
    private final List<Token> tokens;
    private int pos = 0;

    Parser(String text) {
      tokens = tokenize(text);
    }

    Node parse() {
      Node tree = disjunction();
      if (pos != tokens.size()) throw new IllegalArgumentException("unexpected token");
      return tree;
    }

    private Node disjunction() {
      Node tree = conjunction();
      while (take("or")) tree = new Binary("or", tree, conjunction());
      return tree;
    }

    private Node conjunction() {
      Node tree = negation();
      while (take("and")) tree = new Binary("and", tree, negation());
      return tree;
    }

    private Node negation() {
      if (take("not")) return new Not(negation());
      if (take("(")) {
        Node tree = disjunction();
        expect("symbol", ")");
        return tree;
      }
      String metric = expect("word", null);
      if (KEYWORDS.contains(metric)) throw new IllegalArgumentException("a keyword is not a metric");
      String op = expect("symbol", null);
      if (!OPS.contains(op)) throw new IllegalArgumentException("not a comparison");
      String number = expect("number", null);
      if (number.replace("-", "").length() > MAX_DIGITS)
        throw new IllegalArgumentException("number too long");
      return new Compare(metric, op, Long.parseLong(number));
    }

    private boolean take(String text) {
      boolean found = pos < tokens.size() && tokens.get(pos).text().equals(text);
      if (found) pos += 1;
      return found;
    }

    private String expect(String kind, String text) {
      if (pos == tokens.size()) throw new IllegalArgumentException("unexpected end");
      Token got = tokens.get(pos);
      if (!got.kind().equals(kind) || (text != null && !got.text().equals(text)))
        throw new IllegalArgumentException("unexpected token");
      pos += 1;
      return got.text();
    }
  }

  private final Node tree;
  private final Tally seen = new Tally();

  public AlertExpr(String expression) {
    tree = new Parser(expression).parse();
  }

  public boolean evaluate(Map<String, Long> metrics) {
    return tree.evaluate(metrics, seen);
  }

  public List<String> variables() {
    TreeSet<String> out = new TreeSet<>();
    tree.names(out);
    return new ArrayList<>(out);
  }

  public long depth() {
    return tree.depth();
  }

  public long evaluations() {
    return seen.comparisons;
  }

  // The extension round: renaming a metric in the parsed tree.
  public String rewrite(String name, String replacement) {
    if (!variables().contains(name) || !isName(replacement))
      throw new IllegalArgumentException("unknown metric or bad name");
    tree.rename(name, replacement);
    return tree.text();
  }
}
