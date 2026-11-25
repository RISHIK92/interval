// Fees charged and restores made so far, by reads and (in the extension) moves.
class Meter {
  fees = 0;
  restores = 0;
}

interface Stored {
  readonly data: string;
  readonly storageClass: StorageClass;
  restored: boolean;
}

// Every class keeps the same promise: read hands back exactly what was stored. They differ
// only in what that costs, so the bucket never asks which class an object is in.
interface StorageClass {
  readonly rate: number;
  read(stored: Stored, meter: Meter): string;
  leave(stored: Stored, meter: Meter): void;
}

class Standard implements StorageClass {
  readonly rate = 4;

  read(stored: Stored): string {
    return stored.data;
  }

  leave(): void {}
}

class InfrequentAccess implements StorageClass {
  readonly rate = 2;

  read(stored: Stored, meter: Meter): string {
    meter.fees += stored.data.length;
    return stored.data;
  }

  leave(): void {}
}

// Slow to reach, never absent: the first read restores the object, and pays for it,
// instead of failing or answering null.
class Archive implements StorageClass {
  readonly rate = 1;

  read(stored: Stored, meter: Meter): string {
    this.leave(stored, meter);
    return stored.data;
  }

  leave(stored: Stored, meter: Meter): void {
    if (stored.restored) return;
    meter.restores += 1;
    meter.fees += 3 * stored.data.length;
    stored.restored = true;
  }
}

const CLASSES = new Map<string, StorageClass>([
  ["standard", new Standard()],
  ["infrequent-access", new InfrequentAccess()],
  ["archive", new Archive()],
]);

function named(key: string): void {
  if (key === "") throw new RangeError("empty key");
}

function classNamed(name: string): StorageClass {
  const found = CLASSES.get(name);
  if (found === undefined) throw new RangeError("unknown storage class");
  return found;
}

export class StorageBucket {
  private readonly objects = new Map<string, Stored>();
  private readonly meter = new Meter();

  store(key: string, data: string, storageClass: string): void {
    named(key);
    this.objects.set(key, {
      data,
      storageClass: classNamed(storageClass),
      restored: false,
    });
  }

  read(key: string): string | null {
    named(key);
    const stored = this.objects.get(key);
    return stored === undefined
      ? null
      : stored.storageClass.read(stored, this.meter);
  }

  restores(): number {
    return this.meter.restores;
  }

  monthlyCost(): number {
    let keeping = 0;
    for (const s of this.objects.values())
      keeping += s.storageClass.rate * s.data.length;
    return keeping + this.meter.fees;
  }

  // The extension round: a lifecycle move, which each class leaves in its own way.
  transition(key: string, storageClass: string): boolean {
    named(key);
    const target = classNamed(storageClass);
    const stored = this.objects.get(key);
    if (stored === undefined || stored.storageClass === target) return false;
    stored.storageClass.leave(stored, this.meter);
    this.objects.set(key, {
      data: stored.data,
      storageClass: target,
      restored: false,
    });
    return true;
  }
}
