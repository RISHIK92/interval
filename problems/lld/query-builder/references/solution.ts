const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPS = new Set(["=", "<>", "<", "<=", ">", ">=", "LIKE"]);
const MAX_LIMIT = 1_000_000_000;

// Identifiers go into the text, so only a plain name may: no quotes, spaces or dots.
function plainName(identifier: string): string {
  if (!PLAIN.test(identifier)) throw new RangeError("not a plain name");
  return identifier;
}

// A builder: each call records one part of the query, and build() assembles them in
// SQL's order whatever order they came in. Values are only ever kept as parameters, so
// nothing a caller passes as a value can change the statement.
export class QueryBuilder {
  private readonly table: string;
  private selected: string[] = [];
  private readonly conditions: string[] = [];
  private readonly values: string[] = [];
  private readonly order: string[] = [];
  private readonly ordered = new Set<string>();
  private rows: number | null = null;
  private readonly joins: string[] = [];
  private readonly joined = new Set<string>();

  constructor(table: string) {
    this.table = plainName(table);
    this.joined.add(table);
  }

  columns(cols: string[]): void {
    if (cols.length === 0 || new Set(cols).size !== cols.length)
      throw new RangeError("no columns, or one twice");
    this.selected = cols.map(plainName);
  }

  where(column: string, op: string, val: string): void {
    plainName(column);
    if (!OPS.has(op)) throw new RangeError("unknown operator");
    if (val === "") throw new RangeError("empty value");
    this.values.push(val);
    this.conditions.push(`${column} ${op} $${String(this.values.length)}`);
  }

  orderBy(column: string, desc: boolean): void {
    if (this.ordered.has(plainName(column)))
      throw new RangeError("already ordered by it");
    this.ordered.add(column);
    this.order.push(`${column} ${desc ? "DESC" : "ASC"}`);
  }

  limit(n: number): void {
    if (n < 1 || n > MAX_LIMIT) throw new RangeError("limit out of range");
    this.rows = n;
  }

  build(): string {
    let sql = `SELECT ${this.selected.join(", ") || "*"} FROM ${this.table}`;
    sql += this.joins.join("");
    if (this.conditions.length > 0)
      sql += ` WHERE ${this.conditions.join(" AND ")}`;
    if (this.order.length > 0) sql += ` ORDER BY ${this.order.join(", ")}`;
    if (this.rows !== null) sql += ` LIMIT ${String(this.rows)}`;
    return sql;
  }

  params(): string[] {
    return [...this.values];
  }

  // The extension round: joining another table.
  innerJoin(table: string, leftColumn: string, rightColumn: string): void {
    for (const identifier of [table, leftColumn, rightColumn])
      plainName(identifier);
    if (this.joined.has(table))
      throw new RangeError("table already in the query");
    this.joined.add(table);
    this.joins.push(
      ` INNER JOIN ${table} ON ${this.table}.${leftColumn} = ${table}.${rightColumn}`,
    );
  }
}
