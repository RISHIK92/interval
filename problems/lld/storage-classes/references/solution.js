"use strict";

// Every storage class has the same shape: a monthly rate per character, read(stored, meter)
// and leave(stored, meter). Each keeps the same promise, that read hands back exactly what
// was stored; they differ only in what that costs, so the bucket never asks which class an
// object is in. The meter holds the fees charged and restores made so far.

class Standard {
  rate = 4;

  read(stored) {
    return stored.data;
  }

  leave() {}
}

class InfrequentAccess {
  rate = 2;

  read(stored, meter) {
    meter.fees += stored.data.length;
    return stored.data;
  }

  leave() {}
}

// Slow to reach, never absent: the first read restores the object, and pays for it,
// instead of failing or answering null.
class Archive {
  rate = 1;

  read(stored, meter) {
    this.leave(stored, meter);
    return stored.data;
  }

  leave(stored, meter) {
    if (stored.restored) return;
    meter.restores += 1;
    meter.fees += 3 * stored.data.length;
    stored.restored = true;
  }
}

const CLASSES = new Map([
  ["standard", new Standard()],
  ["infrequent-access", new InfrequentAccess()],
  ["archive", new Archive()],
]);

function named(key) {
  if (key === "") throw new RangeError("empty key");
}

function classNamed(name) {
  const found = CLASSES.get(name);
  if (found === undefined) throw new RangeError("unknown storage class");
  return found;
}

class StorageBucket {
  #objects = new Map();
  #meter = { fees: 0, restores: 0 };

  store(key, data, storageClass) {
    named(key);
    this.#objects.set(key, {
      data,
      storageClass: classNamed(storageClass),
      restored: false,
    });
  }

  read(key) {
    named(key);
    const stored = this.#objects.get(key);
    return stored === undefined
      ? null
      : stored.storageClass.read(stored, this.#meter);
  }

  restores() {
    return this.#meter.restores;
  }

  monthlyCost() {
    let keeping = 0;
    for (const s of this.#objects.values())
      keeping += s.storageClass.rate * s.data.length;
    return keeping + this.#meter.fees;
  }

  // The extension round: a lifecycle move, which each class leaves in its own way.
  transition(key, storageClass) {
    named(key);
    const target = classNamed(storageClass);
    const stored = this.#objects.get(key);
    if (stored === undefined || stored.storageClass === target) return false;
    stored.storageClass.leave(stored, this.#meter);
    this.#objects.set(key, {
      data: stored.data,
      storageClass: target,
      restored: false,
    });
    return true;
  }
}

module.exports = { StorageBucket };
