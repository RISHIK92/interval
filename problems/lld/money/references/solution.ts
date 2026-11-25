const LIMIT = 1e12;

function checked(cents: number, currency: string): void {
  if (cents < 0 || cents > LIMIT)
    throw new RangeError("cents must be within 0 and 10^12");
  if (!/^[A-Z]{3}$/.test(currency))
    throw new RangeError("a currency is three capital letters");
}

export class Money {
  private readonly cents: number;
  private readonly currency: string;

  constructor(cents: number, currency: string) {
    checked(cents, currency);
    this.cents = cents;
    this.currency = currency;
  }

  private show(cents: number): string {
    const whole = Math.floor(cents / 100);
    const rest = String(cents % 100).padStart(2, "0");
    return `${this.currency} ${String(whole)}.${rest}`;
  }

  add(cents: number, currency: string): string {
    checked(cents, currency);
    if (currency !== this.currency)
      throw new RangeError("can't add across currencies");
    return this.show(this.cents + cents);
  }

  split(parts: number): string[] {
    if (parts < 1 || parts > 100)
      throw new RangeError("parts must be within 1-100");
    const share = Math.floor(this.cents / parts);
    const left = this.cents % parts;
    return Array.from({ length: parts }, (_, i) =>
      this.show(share + (i < left ? 1 : 0)),
    );
  }

  display(): string {
    return this.show(this.cents);
  }

  // The extension round.
  allocate(weights: number[]): string[] {
    if (
      weights.length < 1 ||
      weights.length > 100 ||
      weights.some((w) => w < 0 || w > 1000)
    )
      throw new RangeError("1-100 weights, each within 0-1000");
    const total = weights.reduce((a, b) => a + b, 0);
    if (total === 0) throw new RangeError("at least one weight above 0");
    const shares = weights.map((w) => Math.floor((this.cents * w) / total));
    let left = this.cents - shares.reduce((a, b) => a + b, 0);
    return weights.map((w, i) => {
      let share = shares[i] ?? 0;
      if (left > 0 && w > 0) {
        share += 1;
        left -= 1;
      }
      return this.show(share);
    });
  }
}
