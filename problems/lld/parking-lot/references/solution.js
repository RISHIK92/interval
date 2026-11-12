"use strict";

const PREFIX = { small: "S", large: "L" };

class ParkingLot {
  constructor(small, large) {
    if (small < 0 || large < 0) throw new RangeError("negative spot count");
    // Free spot numbers per size, kept sorted: the lowest is always first.
    const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
    this.spots = { small: range(small), large: range(large) };
    this.cars = new Map();
  }

  park(plate, size) {
    if (size !== "small" && size !== "large")
      throw new RangeError("unknown size");
    if (this.cars.has(plate)) throw new Error("already parked");
    for (const kind of size === "small" ? ["small", "large"] : ["large"]) {
      if (this.spots[kind].length === 0) continue;
      const number = this.spots[kind].shift();
      this.cars.set(plate, [kind, number]);
      return PREFIX[kind] + number;
    }
    return null;
  }

  leave(plate) {
    const spot = this.cars.get(plate);
    if (spot === undefined) return null;
    this.cars.delete(plate);
    const free = this.spots[spot[0]];
    const at = free.findIndex((n) => n > spot[1]);
    free.splice(at === -1 ? free.length : at, 0, spot[1]);
    return PREFIX[spot[0]] + spot[1];
  }

  where(plate) {
    const spot = this.cars.get(plate);
    return spot === undefined ? null : PREFIX[spot[0]] + spot[1];
  }

  free(size) {
    if (size !== "small" && size !== "large")
      throw new RangeError("unknown size");
    return this.spots[size].length;
  }
}

module.exports = { ParkingLot };
