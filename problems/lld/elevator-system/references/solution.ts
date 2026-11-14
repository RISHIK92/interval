export class ElevatorSystem {
  private readonly top: number;
  private readonly at: number[];
  private stops: Set<number>[];
  // The extension round: elevators out of service.
  private readonly out: boolean[];

  constructor(elevators: number, floors: number) {
    if (elevators < 1 || floors < 1)
      throw new RangeError("need an elevator and a floor");
    this.top = floors;
    this.at = new Array<number>(elevators).fill(0);
    this.stops = Array.from({ length: elevators }, () => new Set<number>());
    this.out = new Array<boolean>(elevators).fill(false);
  }

  private elevator(e: number): void {
    if (e < 0 || e >= this.at.length) throw new RangeError("unknown elevator");
  }

  private floor(f: number): void {
    if (f < 0 || f > this.top) throw new RangeError("unknown floor");
  }

  private target(i: number): number {
    const here = this.at[i] ?? 0;
    let best: number | null = null;
    for (const s of this.stops[i] ?? []) {
      if (
        best === null ||
        Math.abs(s - here) < Math.abs(best - here) ||
        (Math.abs(s - here) === Math.abs(best - here) && s < best)
      )
        best = s;
    }
    return best ?? here;
  }

  private dispatch(floor: number): number {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < this.at.length; i++) {
      if (this.out[i]) continue;
      const stops = this.stops[i] as Set<number>;
      if (stops.has(floor)) return i;
      const cost = Math.abs((this.at[i] as number) - floor) + stops.size;
      if (cost < bestCost) {
        best = i;
        bestCost = cost;
      }
    }
    (this.stops[best] as Set<number>).add(floor);
    return best;
  }

  request(floor: number): number {
    this.floor(floor);
    return this.dispatch(floor);
  }

  press(elevator: number, floor: number): boolean {
    this.elevator(elevator);
    this.floor(floor);
    if (this.out[elevator]) throw new Error("out of service");
    const stops = this.stops[elevator] as Set<number>;
    if (stops.has(floor)) return false;
    stops.add(floor);
    return true;
  }

  step(): string[] {
    const opened: string[] = [];
    for (let i = 0; i < this.at.length; i++) {
      const stops = this.stops[i] as Set<number>;
      if (stops.size === 0) continue;
      const target = this.target(i);
      const here = this.at[i] as number;
      this.at[i] = here + Math.sign(target - here);
      if (stops.delete(this.at[i] as number))
        opened.push(`${String(i)}:${String(this.at[i])}`);
    }
    return opened;
  }

  status(elevator: number): string {
    this.elevator(elevator);
    const here = this.at[elevator] as number;
    if (this.out[elevator]) return `${String(here)} out -`;
    const stops = this.stops[elevator] as Set<number>;
    if (stops.size === 0) return `${String(here)} idle -`;
    const target = this.target(elevator);
    const state = target === here ? "here" : target > here ? "up" : "down";
    return `${String(here)} ${state} ${[...stops].sort((a, b) => a - b).join(",")}`;
  }

  outOfService(elevator: number): boolean {
    this.elevator(elevator);
    if (this.out[elevator]) return false;
    if (this.out.filter((o) => !o).length === 1)
      throw new Error("last elevator in service");
    this.out[elevator] = true;
    const pending = [...(this.stops[elevator] as Set<number>)].sort(
      (a, b) => a - b,
    );
    this.stops[elevator] = new Set<number>();
    for (const floor of pending) this.dispatch(floor);
    return true;
  }
}
