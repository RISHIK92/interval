type Size = "small" | "large";
const PREFIX: Record<Size, string> = { small: "S", large: "L" };

function sizeOf(size: string): Size {
  if (size !== "small" && size !== "large")
    throw new RangeError("unknown size");
  return size;
}

export class ParkingLot {
  // Free spot numbers per size, kept sorted: the lowest is always first.
  private readonly spots: Record<Size, number[]>;
  private readonly cars = new Map<string, [Size, number]>();

  constructor(small: number, large: number) {
    if (small < 0 || large < 0) throw new RangeError("negative spot count");
    const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    this.spots = { small: range(small), large: range(large) };
  }

  park(plate: string, size: string): string | null {
    const wanted = sizeOf(size);
    if (this.cars.has(plate)) throw new Error("already parked");
    const kinds: Size[] = wanted === "small" ? ["small", "large"] : ["large"];
    for (const kind of kinds) {
      const number = this.spots[kind].shift();
      if (number === undefined) continue;
      this.cars.set(plate, [kind, number]);
      return PREFIX[kind] + String(number);
    }
    return null;
  }

  leave(plate: string): string | null {
    const spot = this.cars.get(plate);
    if (spot === undefined) return null;
    this.cars.delete(plate);
    const [kind, number] = spot;
    const free = this.spots[kind];
    const at = free.findIndex((n) => n > number);
    free.splice(at === -1 ? free.length : at, 0, number);
    return PREFIX[kind] + String(number);
  }

  where(plate: string): string | null {
    const spot = this.cars.get(plate);
    return spot === undefined ? null : PREFIX[spot[0]] + String(spot[1]);
  }

  free(size: string): number {
    return this.spots[sizeOf(size)].length;
  }
}
