const PATTERN = /^(?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?$/;

function seconds(text: string): number {
  const match = PATTERN.exec(text);
  if (text === "" || match === null)
    throw new RangeError("a duration is like 1h30m15s");
  const part = (i: number) => Number(match[i] ?? "0");
  return part(1) * 3600 + part(2) * 60 + part(3);
}

function canonical(total: number): string {
  if (total === 0) return "0s";
  const parts: [number, string][] = [
    [Math.floor(total / 3600), "h"],
    [Math.floor(total / 60) % 60, "m"],
    [total % 60, "s"],
  ];
  return parts
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${String(amount)}${unit}`)
    .join("");
}

export class Duration {
  private readonly total: number;

  constructor(text: string) {
    this.total = seconds(text);
  }

  totalSeconds(): number {
    return this.total;
  }

  canonical(): string {
    return canonical(this.total);
  }

  plus(other: string): string {
    return canonical(this.total + seconds(other));
  }

  isLonger(other: string): boolean {
    return this.total > seconds(other);
  }

  // The extension round.
  scaled(factor: number): string {
    if (factor < 0 || factor > 1000)
      throw new RangeError("factor must be within 0-1000");
    return canonical(Math.floor(this.total * factor));
  }
}
