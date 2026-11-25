const MAX_SIZE_GB = 65_536;
const OPS = new Set(["snapshot", "resize", "encrypt"]);

class Volume {
  readonly name: string;
  size: number;
  // Each snapshot id and the size it recorded, oldest first.
  readonly snapshots = new Map<string, number>();

  constructor(name: string, size: number) {
    this.name = name;
    this.size = size;
  }
}

// Each operation is its own narrow capability. A driver holds only the ones it has, so the
// manager can't call an operation a driver lacks: it finds no capability and fails.
class Snapshots {
  take(volume: Volume): string {
    const snapshot = `${volume.name}@${String(volume.snapshots.size + 1)}`;
    volume.snapshots.set(snapshot, volume.size);
    return snapshot;
  }

  restore(volume: Volume, snapshot: string): boolean {
    const size = volume.snapshots.get(snapshot);
    if (size === undefined) return false;
    volume.size = size;
    return true;
  }
}

class Resizing {
  grow(volume: Volume, size: number): boolean {
    if (size <= volume.size) return false;
    volume.size = size;
    return true;
  }
}

// "encrypt" is a known operation, but no call here needs it, so it has no capability yet.
class Driver {
  readonly snapshots: Snapshots | null;
  readonly resizing: Resizing | null;

  constructor(ops: string[]) {
    if (new Set(ops).size !== ops.length || ops.some((op) => !OPS.has(op)))
      throw new Error("ops are distinct, from snapshot, resize and encrypt");
    this.snapshots = ops.includes("snapshot") ? new Snapshots() : null;
    this.resizing = ops.includes("resize") ? new Resizing() : null;
  }
}

function named(text: string): string {
  if (text === "") throw new Error("an empty name");
  return text;
}

function sized(sizeGb: number): number {
  if (sizeGb < 1 || sizeGb > MAX_SIZE_GB)
    throw new RangeError("a size is 1 to 65536 GB");
  return sizeGb;
}

export class VolumeManager {
  private readonly drivers = new Map<string, Driver>();
  private readonly volumes = new Map<
    string,
    { volume: Volume; driver: Driver }
  >();

  driver(name: string, ops: string[]): void {
    if (this.drivers.has(named(name)))
      throw new Error("a driver is registered once");
    this.drivers.set(name, new Driver(ops));
  }

  create(volume: string, driver: string, sizeGb: number): boolean {
    named(volume);
    const found = this.drivers.get(driver);
    if (found === undefined) throw new Error("an unknown driver");
    const size = sized(sizeGb);
    if (this.volumes.has(volume)) return false;
    this.volumes.set(volume, {
      volume: new Volume(volume, size),
      driver: found,
    });
    return true;
  }

  snapshot(volume: string): string {
    const { found, snapshots } = this.snapshotting(volume);
    return snapshots.take(found);
  }

  resize(volume: string, sizeGb: number): boolean {
    const { volume: found, driver } = this.find(volume);
    if (driver.resizing === null) throw new Error("the driver can't resize");
    return driver.resizing.grow(found, sized(sizeGb));
  }

  snapshots(volume: string): string[] {
    return [...this.snapshotting(volume).found.snapshots.keys()];
  }

  // The extension round.
  restore(volume: string, snapshot: string): boolean {
    const { found, snapshots } = this.snapshotting(volume);
    return snapshots.restore(found, named(snapshot));
  }

  private find(volume: string): { volume: Volume; driver: Driver } {
    const entry = this.volumes.get(volume);
    if (entry === undefined) throw new Error("an unknown volume");
    return entry;
  }

  private snapshotting(volume: string): {
    found: Volume;
    snapshots: Snapshots;
  } {
    const { volume: found, driver } = this.find(volume);
    if (driver.snapshots === null) throw new Error("the driver can't snapshot");
    return { found, snapshots: driver.snapshots };
  }
}
