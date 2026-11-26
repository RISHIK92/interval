type Row = Map<string, string>;

const SOURCE = "logs";
const MAX_TOP = 10_000;
const MAX_DIGITS = 9;
const NAME = /^[A-Za-z0-9_.]+$/;
const OPS = new Map<string, (c: number) => boolean>([
  ["=", (c) => c === 0],
  ["!=", (c) => c !== 0],
  ["<", (c) => c < 0],
  ["<=", (c) => c <= 0],
  [">", (c) => c > 0],
  [">=", (c) => c >= 0],
]);

function checkName(text: string): string {
  if (!NAME.test(text))
    throw new RangeError("a name is letters, digits, _ and .");
  return text;
}

function integer(text: string): number | undefined {
  const digits = text.startsWith("-") ? text.slice(1) : text;
  if (digits.length > 0 && digits.length <= MAX_DIGITS && /^\d+$/.test(digits))
    return Number(text);
  return undefined;
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// One order for every stage: integers by value, before every other value, and other
// values by character code.
function compare(a: string, b: string): number {
  const x = integer(a);
  const y = integer(b);
  if (x !== undefined && y !== undefined) return sign(x - y);
  if (x !== undefined) return -1;
  if (y !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Visitor<T> {
  where(s: Where): T;
  count(s: Count): T;
  sort(s: Sort): T;
  top(s: Top): T;
}

interface Stage {
  apply(rows: Row[]): Row[];
  accept<T>(visitor: Visitor<T>): T;
}

class Where implements Stage {
  readonly field: string;
  readonly op: string;
  readonly value: string;

  constructor(field: string, op: string, value: string) {
    this.field = field;
    this.op = op;
    this.value = value;
  }

  apply(rows: Row[]): Row[] {
    const test = OPS.get(this.op) ?? (() => false);
    return rows.filter((r) => {
      const v = r.get(this.field);
      return v !== undefined && test(compare(v, this.value));
    });
  }

  accept<T>(visitor: Visitor<T>): T {
    return visitor.where(this);
  }
}

class Count implements Stage {
  readonly field: string;

  constructor(field: string) {
    this.field = field;
  }

  apply(rows: Row[]): Row[] {
    const counts = new Map<string, number>();
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

  accept<T>(visitor: Visitor<T>): T {
    return visitor.count(this);
  }
}

class Sort implements Stage {
  readonly field: string;
  readonly descending: boolean;

  constructor(field: string, descending: boolean) {
    this.field = field;
    this.descending = descending;
  }

  apply(rows: Row[]): Row[] {
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

  accept<T>(visitor: Visitor<T>): T {
    return visitor.sort(this);
  }
}

class Top implements Stage {
  readonly n: number;

  constructor(n: number) {
    this.n = n;
  }

  apply(rows: Row[]): Row[] {
    return rows.slice(0, this.n);
  }

  accept<T>(visitor: Visitor<T>): T {
    return visitor.top(this);
  }
}

// A visitor: one line per stage, in a canonical spelling.
const explainer: Visitor<string> = {
  where: (s) => `where ${s.field} ${s.op} ${s.value}`,
  count: (s) => `count ${s.field}`,
  sort: (s) => `sort ${s.field} ${s.descending ? "desc" : "asc"}`,
  top: (s) => `top ${String(s.n)}`,
};

// The parsed query: a source and its stages.
interface Pipeline {
  source: string;
  stages: Stage[];
}

function parseStage(words: string[]): Stage {
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

function parse(query: string): Pipeline {
  const parts = query.split("|").map((p) => p.split(" ").filter((w) => w));
  const [first = [], ...rest] = parts;
  if (parts.some((words) => words.length === 0) || first.length !== 1)
    throw new RangeError("an empty part or a bad source");
  return { source: first[0] ?? "", stages: rest.map(parseStage) };
}

export class LogQuery {
  private readonly records: Row[] = [];
  private readonly views = new Map<string, Pipeline>();

  ingest(fields: Record<string, string>): void {
    const entries = Object.entries(fields);
    if (entries.length === 0) throw new RangeError("an empty record");
    for (const [name, value] of entries) {
      checkName(name);
      if (value === "") throw new RangeError("an empty value");
    }
    this.records.push(new Map(entries));
  }

  run(query: string): string[] {
    return this.rows(this.checked(query)).map((r) =>
      [...r.keys()]
        .sort()
        .map((k) => `${k}=${r.get(k) ?? ""}`)
        .join(" "),
    );
  }

  explainQuery(query: string): string[] {
    return this.explain(this.checked(query));
  }

  // The extension round: saved views, usable as sources.
  saveView(name: string, query: string): void {
    checkName(name);
    const pipeline = this.checked(query);
    if (name === SOURCE || this.views.has(name))
      throw new RangeError("that source exists");
    this.views.set(name, pipeline);
  }

  private checked(query: string): Pipeline {
    const pipeline = parse(query);
    if (pipeline.source !== SOURCE && !this.views.has(pipeline.source))
      throw new RangeError("no such source");
    return pipeline;
  }

  private rows(pipeline: Pipeline): Row[] {
    const view = this.views.get(pipeline.source);
    let rows = view === undefined ? this.records : this.rows(view);
    for (const stage of pipeline.stages) rows = stage.apply(rows);
    return rows;
  }

  private explain(pipeline: Pipeline): string[] {
    const view = this.views.get(pipeline.source);
    const lines =
      view === undefined ? [`source ${SOURCE}`] : this.explain(view);
    return [...lines, ...pipeline.stages.map((s) => s.accept(explainer))];
  }
}
