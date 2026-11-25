"use strict";

// [major, minor, patch]; each part is 1 to 9 digits with no leading zero.
function parse(text) {
  const parts = text.split(".");
  if (parts.length !== 3)
    throw new RangeError("a version is major.minor.patch");
  for (const part of parts) {
    if (!/^[0-9]{1,9}$/.test(part))
      throw new RangeError("each part is 1 to 9 digits");
    if (part[0] === "0" && part.length > 1)
      throw new RangeError("no leading zeros");
  }
  return parts.map(Number);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function compatible(a, b) {
  if (a[0] !== b[0]) return false;
  return a[0] > 0 || a[1] === b[1];
}

class SemVer {
  #version;

  constructor(text) {
    this.#version = parse(text);
  }

  bump(part) {
    const [major, minor, patch] = this.#version;
    if (part === "major") return `${major + 1}.0.0`;
    if (part === "minor") return `${major}.${minor + 1}.0`;
    if (part === "patch") return `${major}.${minor}.${patch + 1}`;
    throw new RangeError("part is major, minor or patch");
  }

  compareTo(other) {
    return compare(this.#version, parse(other));
  }

  isCompatible(other) {
    return compatible(this.#version, parse(other));
  }

  text() {
    return this.#version.join(".");
  }

  // The extension round.
  satisfies(constraint) {
    const op = constraint[0];
    if (op !== "^" && op !== "~")
      throw new RangeError("a constraint is ^ or ~ and a version");
    const base = parse(constraint.slice(1));
    if (compare(this.#version, base) < 0) return false;
    if (op === "^") return compatible(this.#version, base);
    return this.#version[0] === base[0] && this.#version[1] === base[1];
  }
}

module.exports = { SemVer };
