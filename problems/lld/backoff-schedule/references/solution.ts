const MAX_ATTEMPTS = 1000;
const MAX_CAP_MS = 1_000_000_000;

// The one thing that varies between schedules: the delay before an attempt, at most
// `cap`. Growth stops at the cap, so no kind ever overflows.
interface Growth {
  delay(attempt: number, base: number, cap: number): number;
}

const fixed: Growth = { delay: (_attempt, base) => base };

const linear: Growth = {
  delay: (attempt, base, cap) => Math.min(base * attempt, cap),
};

const exponential: Growth = {
  delay(attempt, base, cap) {
    let d = base;
    for (let a = 1; a < attempt && d < cap; a++) d *= 2;
    return Math.min(d, cap);
  },
};

const fibonacci: Growth = {
  delay(attempt, base, cap) {
    let previous = 0;
    let current = base;
    for (let a = 1; a < attempt && current < cap; a++)
      [previous, current] = [current, previous + current];
    return Math.min(current, cap);
  },
};

const KINDS = new Map<string, Growth>([
  ["fixed", fixed],
  ["linear", linear],
  ["exponential", exponential],
]);

function growthOf(kind: string): Growth {
  const growth = KINDS.get(kind);
  if (growth === undefined) throw new RangeError("unknown kind");
  return growth;
}

function count(n: number, low: number): void {
  if (n < low || n > MAX_ATTEMPTS)
    throw new RangeError("attempts out of range");
}

// Caps, schedules and totals are the same for every kind; only the growth is swapped.
export class BackoffSchedule {
  private growth: Growth;
  private readonly base: number;
  private readonly cap: number;

  constructor(kind: string, baseMs: number, capMs: number) {
    const growth = growthOf(kind);
    if (baseMs < 1 || capMs < baseMs || capMs > MAX_CAP_MS)
      throw new RangeError("1 <= baseMs <= capMs <= 10^9");
    this.growth = growth;
    this.base = baseMs;
    this.cap = capMs;
  }

  delay(attempt: number): number {
    count(attempt, 1);
    return this.growth.delay(attempt, this.base, this.cap);
  }

  schedule(attempts: number): number[] {
    count(attempts, 0);
    return Array.from({ length: attempts }, (_, i) => this.delay(i + 1));
  }

  totalMs(attempts: number): number {
    return this.schedule(attempts).reduce((sum, d) => sum + d, 0);
  }

  switchTo(kind: string): void {
    this.growth = growthOf(kind);
  }

  // The extension round: one more growth, and nothing else changes.
  fibonacci(): void {
    this.growth = fibonacci;
  }
}
