type Resources = Map<string, Map<string, string>>;

const copy = (resources: Resources): Resources =>
  new Map([...resources].map(([name, attrs]) => [name, new Map(attrs)]));

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The memento: a frozen copy of the state that only InfraState reads back.
class Snapshot {
  readonly label: string;
  private readonly saved: Resources;

  constructor(label: string, resources: Resources) {
    this.label = label;
    this.saved = copy(resources);
  }

  resources(): Resources {
    return copy(this.saved);
  }
}

export class InfraState {
  private current: Resources = new Map();
  // The caretaker's side: snapshots by id, known here only by their labels.
  private readonly snapshots = new Map<number, Snapshot>();
  private lastId = 0;

  apply(resource: string, attrs: Record<string, string>): void {
    const entries = Object.entries(attrs);
    if (resource === "" || entries.some(([k, v]) => k === "" || v === ""))
      throw new Error("empty name or value");
    this.current.set(resource, new Map(entries));
  }

  destroy(resource: string): boolean {
    if (resource === "") throw new Error("empty resource");
    return this.current.delete(resource);
  }

  snapshot(label: string): number {
    if (label === "") throw new Error("empty label");
    for (const [id, snap] of this.snapshots)
      if (snap.label === label) this.snapshots.delete(id);
    this.lastId += 1;
    this.snapshots.set(this.lastId, new Snapshot(label, this.current));
    return this.lastId;
  }

  restore(snapshotId: number): boolean {
    const snap = this.snapshots.get(snapshotId);
    if (snap === undefined) return false;
    this.current = snap.resources();
    return true;
  }

  diffSince(snapshotId: number): string[] {
    const snap = this.snapshots.get(snapshotId);
    if (snap === undefined) throw new Error("unknown snapshot");
    const then = snap.resources();
    const names = [...new Set([...then.keys(), ...this.current.keys()])].sort(
      byCode,
    );
    const out: string[] = [];
    for (const name of names) {
      const before = then.get(name);
      const now = this.current.get(name);
      if (before === undefined) out.push(`+ ${name}`);
      else if (now === undefined) out.push(`- ${name}`);
      else {
        const keys = [...new Set([...before.keys(), ...now.keys()])]
          .filter((k) => before.get(k) !== now.get(k))
          .sort(byCode);
        if (keys.length > 0) out.push(`~ ${name}: ${keys.join(",")}`);
      }
    }
    return out;
  }

  // The extension round: keeping only the newest snapshots.
  prune(keep: number): number {
    if (keep < 0) throw new Error("negative keep");
    const ids = [...this.snapshots.keys()].sort((a, b) => a - b);
    const dropped = ids.slice(0, Math.max(ids.length - keep, 0));
    for (const id of dropped) this.snapshots.delete(id);
    return dropped.length;
  }
}
