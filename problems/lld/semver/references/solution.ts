type Version = [number, number, number];

// Each part is 1 to 9 digits with no leading zero.
function parse(text: string): Version {
  const parts = text.split(".");
  if (parts.length !== 3)
    throw new RangeError("a version is major.minor.patch");
  for (const part of parts) {
    if (!/^[0-9]{1,9}$/.test(part))
      throw new RangeError("each part is 1 to 9 digits");
    if (part.startsWith("0") && part.length > 1)
      throw new RangeError("no leading zeros");
  }
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function compatible(a: Version, b: Version): boolean {
  if (a[0] !== b[0]) return false;
  return a[0] > 0 || a[1] === b[1];
}

export class SemVer {
  private readonly version: Version;

  constructor(text: string) {
    this.version = parse(text);
  }

  bump(part: string): string {
    const [major, minor, patch] = this.version;
    if (part === "major") return `${String(major + 1)}.0.0`;
    if (part === "minor") return `${String(major)}.${String(minor + 1)}.0`;
    if (part === "patch")
      return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
    throw new RangeError("part is major, minor or patch");
  }

  compareTo(other: string): number {
    return compare(this.version, parse(other));
  }

  isCompatible(other: string): boolean {
    return compatible(this.version, parse(other));
  }

  text(): string {
    return this.version.join(".");
  }

  // The extension round.
  satisfies(constraint: string): boolean {
    const op = constraint.slice(0, 1);
    if (op !== "^" && op !== "~")
      throw new RangeError("a constraint is ^ or ~ and a version");
    const base = parse(constraint.slice(1));
    if (compare(this.version, base) < 0) return false;
    if (op === "^") return compatible(this.version, base);
    return this.version[0] === base[0] && this.version[1] === base[1];
  }
}
