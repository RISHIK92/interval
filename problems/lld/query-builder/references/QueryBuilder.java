import java.util.*;
import java.util.regex.Pattern;

// A builder: each call records one part of the query, and build() assembles them in
// SQL's order whatever order they came in. Values are only ever kept as parameters, so
// nothing a caller passes as a value can change the statement.
public class QueryBuilder {
  private static final Pattern PLAIN = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
  private static final Set<String> OPS = Set.of("=", "<>", "<", "<=", ">", ">=", "LIKE");
  private static final long MAX_LIMIT = 1_000_000_000L;

  // Identifiers go into the text, so only a plain name may: no quotes, spaces or dots.
  private static String plainName(String identifier) {
    if (!PLAIN.matcher(identifier).matches()) throw new IllegalArgumentException("not a plain name");
    return identifier;
  }

  private final String table;
  private List<String> selected = new ArrayList<>();
  private final List<String> conditions = new ArrayList<>();
  private final List<String> values = new ArrayList<>();
  private final List<String> order = new ArrayList<>();
  private final Set<String> ordered = new HashSet<>();
  private Long rows = null;
  private final List<String> joins = new ArrayList<>();
  private final Set<String> joined = new HashSet<>();

  public QueryBuilder(String table) {
    this.table = plainName(table);
    joined.add(table);
  }

  public void columns(List<String> cols) {
    if (cols.isEmpty() || new HashSet<>(cols).size() != cols.size())
      throw new IllegalArgumentException("no columns, or one twice");
    List<String> checked = new ArrayList<>();
    for (String c : cols) checked.add(plainName(c));
    selected = checked;
  }

  public void where(String column, String op, String val) {
    plainName(column);
    if (!OPS.contains(op)) throw new IllegalArgumentException("unknown operator");
    if (val.isEmpty()) throw new IllegalArgumentException("empty value");
    values.add(val);
    conditions.add(column + " " + op + " $" + values.size());
  }

  public void orderBy(String column, boolean desc) {
    if (ordered.contains(plainName(column))) throw new IllegalArgumentException("already ordered by it");
    ordered.add(column);
    order.add(column + (desc ? " DESC" : " ASC"));
  }

  public void limit(long n) {
    if (n < 1 || n > MAX_LIMIT) throw new IllegalArgumentException("limit out of range");
    rows = n;
  }

  public String build() {
    StringBuilder sql = new StringBuilder("SELECT ");
    sql.append(selected.isEmpty() ? "*" : String.join(", ", selected)).append(" FROM ").append(table);
    for (String join : joins) sql.append(join);
    if (!conditions.isEmpty()) sql.append(" WHERE ").append(String.join(" AND ", conditions));
    if (!order.isEmpty()) sql.append(" ORDER BY ").append(String.join(", ", order));
    if (rows != null) sql.append(" LIMIT ").append(rows);
    return sql.toString();
  }

  public List<String> params() {
    return new ArrayList<>(values);
  }

  // The extension round: joining another table.
  public void innerJoin(String table, String leftColumn, String rightColumn) {
    for (String identifier : List.of(table, leftColumn, rightColumn)) plainName(identifier);
    if (joined.contains(table)) throw new IllegalArgumentException("table already in the query");
    joined.add(table);
    joins.add(" INNER JOIN " + table + " ON " + this.table + "." + leftColumn + " = " + table + "." + rightColumn);
  }
}
