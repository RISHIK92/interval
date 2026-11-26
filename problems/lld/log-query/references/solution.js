"use strict";

const SOURCE = "logs";
const MAX_TOP = 10_000;
const MAX_DIGITS = 9;
const NAME = /^[A-Za-z0-9_.]+$/;
const OPS = new Map([
  ["=", (c) => c === 0],
  ["!=", (c) => c !== 0],
  ["<", (c) => c < 0],
  ["<=", (c) => c <= 0],
  [">", (c) => c > 0],
  [">=", (c) => c >= 0],
]);

function checkName(text) {
  if (!NAME.test(text))
    throw new RangeError("a name is letters, digits, _ and .");
  return text;
}

function integer(text) {
  const digits = text.startsWith("-") ? text.slice(1) : text;
  if (digits.length > 0 && digits.length <= MAX_DIGITS && /^\d+$/.test(digits))
    return Number(text);
  return undefined;
}

const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// One order for every stage: integers by value, before every other value, and other
// values by character code.
function compare(a, b) {
  const x = integer(a);
  const y = integer(b);
  if (x !== undefined && y !== undefined) return sign(x - y);
  if (x !== undefined) return -1;
  if (y !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

class Where {
  constructor(field, op, value) {
    this.field = field;
    this.op = op;
    this.value = value;
  }

  apply(rows) {
    const test = OPS.get(this.op) ?? (() => false);
    return rows.filter((r) => {
      const v = r.get(this.field);
      return v !== undefined && test(compare(v, this.value));
    });
  }

  accept(visitor) {
    return visitor.where(this);
  }
}

class Count {
  constructor(field) {
    this.field = field;
  }

  apply(rows) {
    const counts = new Map();
    for (const r of rows) {
      const v = r.get(this.field);
      if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts].map(
      ([v, n]) =>
        new Map([
          [this.field, v],
          ["count", String(n)],
        ]),
    );
  }

  accept(visitor) {
    return visitor.count(this);
  }
}

class Sort {
  constructor(field, descending) {
    this.field = field;
    this.descending = descending;
  }

  apply(rows) {
    const order = this.descending ? -1 : 1;
    // Array.prototype.sort is stable: equal rows keep their order.
    const having = rows
      .filter((r) => r.has(this.field))
      .sort(
        (a, b) =>
          order * compare(a.get(this.field) ?? "", b.get(this.field) ?? ""),
      );
    return [...having, ...rows.filter((r) => !r.has(this.field))];
  }

  accept(visitor) {
    return visitor.sort(this);
  }
}

class Top {
  constructor(n) {
    this.n = n;
  }

  apply(rows) {
    return rows.slice(0, this.n);
  }

  accept(visitor) {
    return visitor.top(this);
  }
}

// A visitor: one line per stage, in a canonical spelling.
const explainer = {
  where: (s) => `where ${s.field} ${s.op} ${s.value}`,
  count: (s) => `count ${s.field}`,
  sort: (s) => `sort ${s.field} ${s.descending ? "desc" : "asc"}`,
  top: (s) => `top ${String(s.n)}`,
};

function parseStage(words) {
  const [kind, a = "", b = "", c = ""] = words;
  const n = words.length;
  if (kind === "where" && n === 4 && OPS.has(b))
    return new Where(checkName(a), b, c);
  if (kind === "count" && n === 2 && a !== "count")
    return new Count(checkName(a));
  if (kind === "sort" && n === 2) return new Sort(checkName(a), false);
  if (kind === "sort" && n === 3 && (b === "asc" || b === "desc"))
    return new Sort(checkName(a), b === "desc");
  if (kind === "top" && n === 2 && /^\d{1,5}$/.test(a)) {
    const top = Number(a);
    if (top >= 1 && top <= MAX_TOP) return new Top(top);
  }
  throw new RangeError("not a stage");
}

function parse(query) {
  const parts = query.split("|").map((p) => p.split(" ").filter((w) => w));
  const [first = [], ...rest] = parts;
  if (parts.some((words) => words.length === 0) || first.length !== 1)
    throw new RangeError("an empty part or a bad source");
  return { source: first[0] ?? "", stages: rest.map(parseStage) };
}

class LogQuery {
  records = [];
  views = new Map();

  ingest(fields) {
    const entries = Object.entries(fields);
    if (entries.length === 0) throw new RangeError("an empty record");
    for (const [name, value] of entries) {
      checkName(name);
      if (value === "") throw new RangeError("an empty value");
    }
    this.records.push(new Map(entries));
  }

  run(query) {
    return this.rows(this.checked(query)).map((r) =>
      [...r.keys()]
        .sort()
        .map((k) => `${k}=${r.get(k) ?? ""}`)
        .join(" "),
    );
  }

  explainQuery(query) {
    return this.explain(this.checked(query));
  }

  // The extension round: saved views, usable as sources.
  saveView(name, query) {
    checkName(name);
    const pipeline = this.checked(query);
    if (name === SOURCE || this.views.has(name))
      throw new RangeError("that source exists");
    this.views.set(name, pipeline);
  }

  checked(query) {
    const pipeline = parse(query);
    if (pipeline.source !== SOURCE && !this.views.has(pipeline.source))
      throw new RangeError("no such source");
    return pipeline;
  }

  rows(pipeline) {
    const view = this.views.get(pipeline.source);
    let rows = view === undefined ? this.records : this.rows(view);
    for (const stage of pipeline.stages) rows = stage.apply(rows);
    return rows;
  }

  explain(pipeline) {
    const view = this.views.get(pipeline.source);
    const lines =
      view === undefined ? [`source ${SOURCE}`] : this.explain(view);
    return [...lines, ...pipeline.stages.map((s) => s.accept(explainer))];
  }
}

module.exports = { LogQuery };
