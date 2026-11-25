"use strict";

// Parsing, grouping and rendering are three units with one reason to change each: a new
// message syntax touches only the parser, a new section only the grouper, a new layout
// only the renderer. Changelog just keeps the commits and wires the three together.

const HEADER = /^([a-z]+)(?:\(([^()]+)\))?(!?): (.+)$/;

function parse(sha, message) {
  const found = HEADER.exec(message);
  if (found === null) return null;
  const [, kind, scope, bang, description] = found;
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

// [title, entries] pairs in the order they print, empty sections left out.
function group(entries, breakingFirst) {
  const titles = [
    ...(breakingFirst ? ["BREAKING"] : []),
    ...SECTIONS.values(),
    OTHER,
  ];
  const sections = new Map(titles.map((t) => [t, []]));
  for (const entry of entries) {
    const title =
      breakingFirst && entry.breaking
        ? "BREAKING"
        : (SECTIONS.get(entry.kind) ?? OTHER);
    sections.get(title).push(entry);
  }
  return [...sections].filter(([, listed]) => listed.length > 0);
}

function render(version, sections) {
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

function given(value) {
  if (value === "") throw new RangeError("empty");
}

class Changelog {
  #pending = [];
  #shas = new Set();
  #versions = new Set();
  #breakingFirst = false;

  commit(sha, message) {
    given(sha);
    given(message);
    const entry = parse(sha, message);
    if (entry === null || this.#shas.has(sha)) return false;
    this.#shas.add(sha);
    this.#pending.push(entry);
    return true;
  }

  release(version) {
    given(version);
    if (this.#versions.has(version)) throw new RangeError("already released");
    if (this.#pending.length === 0) throw new RangeError("nothing to release");
    const lines = render(version, group(this.#pending, this.#breakingFirst));
    this.#versions.add(version);
    this.#pending = [];
    return lines;
  }

  unreleased() {
    return this.#pending.length;
  }

  // The extension round: one more grouping rule, and only the grouper hears about it.
  breakingSection(on) {
    this.#breakingFirst = on;
  }
}

module.exports = { Changelog };
