"use strict";

const MAX_SIZE_GB = 65_536;
const OPS = new Set(["snapshot", "resize", "encrypt"]);

class Volume {
  constructor(name, size) {
    this.name = name;
    this.size = size;
    // Each snapshot id and the size it recorded, oldest first.
    this.snapshots = new Map();
  }
}

// Each operation is its own narrow capability. A driver holds only the ones it has, so the
// manager can't call an operation a driver lacks: it finds no capability and fails.
class Snapshots {
  take(volume) {
    const snapshot = `${volume.name}@${volume.snapshots.size + 1}`;
    volume.snapshots.set(snapshot, volume.size);
    return snapshot;
  }

  restore(volume, snapshot) {
    if (!volume.snapshots.has(snapshot)) return false;
    volume.size = volume.snapshots.get(snapshot);
    return true;
  }
}

class Resizing {
  grow(volume, size) {
    if (size <= volume.size) return false;
    volume.size = size;
    return true;
  }
}

// "encrypt" is a known operation, but no call here needs it, so it has no capability yet.
class Driver {
  constructor(ops) {
    if (new Set(ops).size !== ops.length || ops.some((op) => !OPS.has(op)))
      throw new Error("ops are distinct, from snapshot, resize and encrypt");
    this.snapshots = ops.includes("snapshot") ? new Snapshots() : null;
    this.resizing = ops.includes("resize") ? new Resizing() : null;
  }
}

function named(text) {
  if (text === "") throw new Error("an empty name");
  return text;
}

function sized(sizeGb) {
  if (sizeGb < 1 || sizeGb > MAX_SIZE_GB)
    throw new RangeError("a size is 1 to 65536 GB");
  return sizeGb;
}

class VolumeManager {
  constructor() {
    this.drivers = new Map();
    this.volumes = new Map();
  }

  driver(name, ops) {
    if (this.drivers.has(named(name)))
      throw new Error("a driver is registered once");
    this.drivers.set(name, new Driver(ops));
  }

  create(volume, driver, sizeGb) {
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

  snapshot(volume) {
    const { found, snapshots } = this.snapshotting(volume);
    return snapshots.take(found);
  }

  resize(volume, sizeGb) {
    const { volume: found, driver } = this.find(volume);
    if (driver.resizing === null) throw new Error("the driver can't resize");
    return driver.resizing.grow(found, sized(sizeGb));
  }

  snapshots(volume) {
    return [...this.snapshotting(volume).found.snapshots.keys()];
  }

  // The extension round.
  restore(volume, snapshot) {
    const { found, snapshots } = this.snapshotting(volume);
    return snapshots.restore(found, named(snapshot));
  }

  find(volume) {
    const entry = this.volumes.get(volume);
    if (entry === undefined) throw new Error("an unknown volume");
    return entry;
  }

  snapshotting(volume) {
    const { volume: found, driver } = this.find(volume);
    if (driver.snapshots === null) throw new Error("the driver can't snapshot");
    return { found, snapshots: driver.snapshots };
  }
}

module.exports = { VolumeManager };
