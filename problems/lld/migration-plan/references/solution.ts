const MAX_VERSION = 10 ** 9;

// A broken precondition fails the call before anything changes.
function precondition(condition: boolean, why: string): void {
  if (!condition) throw new RangeError(why);
}

// How many of the sorted versions are at or below `version`.
function countUpTo(versions: number[], version: number): number {
  let n = 0;
  while (n < versions.length && (versions[n] ?? 0) <= version) n += 1;
  return n;
}

// Invariant: the applied migrations are exactly the lowest `applied` versions, so the
// current version is the last of them and everything above it is pending.
export class MigrationPlan {
  private readonly names = new Map<number, string>();
  private readonly versions: number[] = [];
  private applied = 0;
  private readonly locked = new Set<number>();

  // Only called with planned versions; the fallback only satisfies the type.
  private nameOf(version: number): string {
    return this.names.get(version) ?? "";
  }

  add(version: number, name: string): void {
    precondition(
      version >= 1 && version <= MAX_VERSION,
      "versions are within 1 and 10^9",
    );
    precondition(name !== "", "a migration has a name");
    precondition(!this.names.has(version), "that version is already planned");
    // It must land above every applied migration, or it could never be applied.
    precondition(
      version > this.current(),
      "that version is below the current one",
    );
    this.names.set(version, name);
    this.versions.splice(countUpTo(this.versions, version), 0, version);
  }

  applyUpTo(version: number): string[] {
    precondition(this.names.has(version), "unknown version");
    precondition(version >= this.current(), "applying never goes down");
    const start = this.applied;
    this.applied = countUpTo(this.versions, version);
    return this.versions.slice(start, this.applied).map((v) => this.nameOf(v));
  }

  rollback(steps: number): string[] {
    precondition(
      steps >= 1 && steps <= this.applied,
      "steps are within 1 and the applied count",
    );
    const undone = this.versions
      .slice(this.applied - steps, this.applied)
      .reverse();
    precondition(
      !undone.some((v) => this.locked.has(v)),
      "an irreversible migration is in the way",
    );
    this.applied -= steps;
    return undone.map((v) => this.nameOf(v));
  }

  // versions[applied - 1] exists whenever applied > 0; the fallback only satisfies the type.
  current(): number {
    return this.applied > 0 ? (this.versions[this.applied - 1] ?? 0) : 0;
  }

  pending(): number[] {
    return this.versions.slice(this.applied);
  }

  // The extension round: one more precondition on rollback.
  irreversible(version: number): void {
    precondition(this.names.has(version), "unknown version");
    this.locked.add(version);
  }
}
