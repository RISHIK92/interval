// Parsing, grouping and rendering are three units with one reason to change each: a new
// message syntax touches only the parser, a new section only the grouper, a new layout
// only the renderer. Changelog just keeps the commits and wires the three together.

const HEADER = /^([a-z]+)(?:\(([^()]+)\))?(!?): (.+)$/;

interface Entry {
  readonly sha: string;
  readonly kind: string;
  readonly scope: string | null;
  readonly breaking: boolean;
  readonly description: string;
}

function parse(sha: string, message: string): Entry | null {
  const found = HEADER.exec(message);
  if (found === null) return null;
  const [, kind = "", scope, bang, description = ""] = found;
  return {
    sha,
    kind,
    scope: scope ?? null,
    breaking: bang === "!",
    description,
  };
}

const SECTIONS = new Map([
  ["feat", "Features"],
  ["fix", "Fixes"],
]);
const OTHER = "Other";

type Section = [title: string, entries: Entry[]];

function group(entries: Entry[], breakingFirst: boolean): Section[] {
  const titles = [
    ...(breakingFirst ? ["BREAKING"] : []),
    ...SECTIONS.values(),
    OTHER,
  ];
  const sections = new Map<string, Entry[]>(titles.map((t) => [t, []]));
  for (const entry of entries) {
    const title =
      breakingFirst && entry.breaking
        ? "BREAKING"
        : (SECTIONS.get(entry.kind) ?? OTHER);
    const listed = sections.get(title);
    if (listed === undefined) throw new Error("every title is listed above");
    listed.push(entry);
  }
  return [...sections].filter(([, listed]) => listed.length > 0);
}

function render(version: string, sections: Section[]): string[] {
  const lines = [`## ${version}`];
  for (const [title, entries] of sections) {
    lines.push(`### ${title}`);
    for (const entry of entries) {
      const scope = entry.scope === null ? "" : `${entry.scope}: `;
      lines.push(`- ${scope}${entry.description} (${entry.sha.slice(0, 7)})`);
    }
  }
  return lines;
}

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

export class Changelog {
  private pending: Entry[] = [];
  private readonly shas = new Set<string>();
  private readonly versions = new Set<string>();
  private breakingFirst = false;

  commit(sha: string, message: string): boolean {
    given(sha);
    given(message);
    const entry = parse(sha, message);
    if (entry === null || this.shas.has(sha)) return false;
    this.shas.add(sha);
    this.pending.push(entry);
    return true;
  }

  release(version: string): string[] {
    given(version);
    if (this.versions.has(version)) throw new RangeError("already released");
    if (this.pending.length === 0) throw new RangeError("nothing to release");
    const lines = render(version, group(this.pending, this.breakingFirst));
    this.versions.add(version);
    this.pending = [];
    return lines;
  }

  unreleased(): number {
    return this.pending.length;
  }

  // The extension round: one more grouping rule, and only the grouper hears about it.
  breakingSection(on: boolean): void {
    this.breakingFirst = on;
  }
}
