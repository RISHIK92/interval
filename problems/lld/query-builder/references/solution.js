"use strict";

const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPS = new Set(["=", "<>", "<", "<=", ">", ">=", "LIKE"]);
const MAX_LIMIT = 1_000_000_000;

// Identifiers go into the text, so only a plain name may: no quotes, spaces or dots.
function plainName(identifier) {
  if (!PLAIN.test(identifier)) throw new RangeError("not a plain name");
  return identifier;
}

// A builder: each call records one part of the query, and build() assembles them in
// SQL's order whatever order they came in. Values are only ever kept as parameters, so
// nothing a caller passes as a value can change the statement.
class QueryBuilder {
  #table;
  #selected = [];
  #conditions = [];
  #values = [];
  #order = [];
  #ordered = new Set();
  #rows = null;
  #joins = [];
  #joined = new Set();

  constructor(table) {
    this.#table = plainName(table);
    this.#joined.add(table);
  }

  columns(cols) {
    if (cols.length === 0 || new Set(cols).size !== cols.length)
      throw new RangeError("no columns, or one twice");
    this.#selected = cols.map(plainName);
  }

  where(column, op, val) {
    plainName(column);
    if (!OPS.has(op)) throw new RangeError("unknown operator");
    if (val === "") throw new RangeError("empty value");
    this.#values.push(val);
    this.#conditions.push(`${column} ${op} $${this.#values.length}`);
  }

  orderBy(column, desc) {
    if (this.#ordered.has(plainName(column)))
      throw new RangeError("already ordered by it");
    this.#ordered.add(column);
    this.#order.push(`${column} ${desc ? "DESC" : "ASC"}`);
  }

  limit(n) {
    if (n < 1 || n > MAX_LIMIT) throw new RangeError("limit out of range");
    this.#rows = n;
  }

  build() {
    let sql = `SELECT ${this.#selected.join(", ") || "*"} FROM ${this.#table}`;
    sql += this.#joins.join("");
    if (this.#conditions.length > 0)
      sql += ` WHERE ${this.#conditions.join(" AND ")}`;
    if (this.#order.length > 0) sql += ` ORDER BY ${this.#order.join(", ")}`;
    if (this.#rows !== null) sql += ` LIMIT ${this.#rows}`;
    return sql;
  }

  params() {
    return [...this.#values];
  }

  // The extension round: joining another table.
  innerJoin(table, leftColumn, rightColumn) {
    for (const identifier of [table, leftColumn, rightColumn])
      plainName(identifier);
    if (this.#joined.has(table))
      throw new RangeError("table already in the query");
    this.#joined.add(table);
    this.#joins.push(
      ` INNER JOIN ${table} ON ${this.#table}.${leftColumn} = ${table}.${rightColumn}`,
    );
  }
}

module.exports = { QueryBuilder };
