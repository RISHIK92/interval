const MAX_RATE = 1e6;
const MAX_HOURS = 1e4;

// One instance: the hours it has run. Each kind turns them into cents its own way.
abstract class Instance {
  protected hours = 0;
  protected readonly hourly: number;

  constructor(hourly: number) {
    this.hourly = hourly;
  }

  run(hours: number): void {
    this.hours += hours;
  }

  abstract bill(): number;

  interrupt(): boolean {
    throw new RangeError("only a spot instance can be interrupted");
  }
}

class OnDemand extends Instance {
  bill(): number {
    return this.hours * this.hourly;
  }
}

class Reserved extends Instance {
  // 100 hours paid up front, then 60% of the rate over all the hours run.
  bill(): number {
    return (
      100 * this.hourly + Math.floor((this.hours * this.hourly * 60) / 100)
    );
  }
}

class Spot extends Instance {
  private interrupted = false;

  // Once interrupted, runs are still accepted but no longer billed.
  override run(hours: number): void {
    if (!this.interrupted) super.run(hours);
  }

  bill(): number {
    return Math.floor((this.hours * this.hourly * 30) / 100);
  }

  override interrupt(): boolean {
    const first = !this.interrupted;
    this.interrupted = true;
    return first;
  }
}

class Dedicated extends Instance {
  private runs = 0;
  private readonly hostFee: number;

  constructor(hourly: number, hostFee: number) {
    super(hourly);
    this.hostFee = hostFee;
  }

  override run(hours: number): void {
    super.run(hours);
    this.runs += 1;
  }

  bill(): number {
    return this.hours * this.hourly + this.runs * this.hostFee;
  }
}

const KINDS = new Map<string, new (hourly: number) => Instance>([
  ["on-demand", OnDemand],
  ["reserved", Reserved],
  ["spot", Spot],
]);

function rate(cents: number): number {
  if (cents < 1 || cents > MAX_RATE)
    throw new RangeError("hourlyCents must be within 1 and 10^6");
  return cents;
}

export class BillingMeter {
  private readonly instances = new Map<string, Instance>();

  private add(id: string, instance: Instance): void {
    if (id === "" || this.instances.has(id))
      throw new RangeError("an instance needs a new, non-empty id");
    this.instances.set(id, instance);
  }

  private find(id: string): Instance {
    const instance = this.instances.get(id);
    if (instance === undefined) throw new RangeError("no such instance");
    return instance;
  }

  launch(id: string, kind: string, hourlyCents: number): void {
    const Kind = KINDS.get(kind);
    if (Kind === undefined) throw new RangeError("unknown kind");
    this.add(id, new Kind(rate(hourlyCents)));
  }

  run(id: string, hours: number): void {
    if (hours < 1 || hours > MAX_HOURS)
      throw new RangeError("hours must be within 1 and 10^4");
    this.find(id).run(hours);
  }

  bill(id: string): number {
    return this.find(id).bill();
  }

  total(): number {
    let sum = 0;
    for (const instance of this.instances.values()) sum += instance.bill();
    return sum;
  }

  interrupt(id: string): boolean {
    return this.find(id).interrupt();
  }

  // The extension round: a fourth kind, added without touching the others.
  launchDedicated(id: string, hourlyCents: number, hostFeeCents: number): void {
    if (hostFeeCents < 0 || hostFeeCents > MAX_RATE)
      throw new RangeError("hostFeeCents must be within 0 and 10^6");
    this.add(id, new Dedicated(rate(hourlyCents), hostFeeCents));
  }
}
