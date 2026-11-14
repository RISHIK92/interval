const COINS = [100, 25, 10, 5];

interface Slot {
  item: string;
  price: number;
  count: number;
}

export class VendingMachine {
  private readonly slots = new Map<string, Slot>();
  private coins = new Map<number, number>(COINS.map((c) => [c, 0]));
  private pending = new Map<number, number>(COINS.map((c) => [c, 0]));

  private slot(slot: string): Slot {
    const entry = this.slots.get(slot);
    if (entry === undefined) throw new RangeError("unknown slot");
    return entry;
  }

  private coin(coin: number): void {
    if (!this.coins.has(coin)) throw new RangeError("not a coin");
  }

  private credit(): number {
    let sum = 0;
    for (const [c, n] of this.pending) sum += c * n;
    return sum;
  }

  stock(slot: string, item: string, price: number, count: number): void {
    if (slot === "" || item === "" || price <= 0 || count < 0)
      throw new RangeError("invalid stock");
    this.slots.set(slot, { item, price, count });
  }

  insert(coin: number): number {
    this.coin(coin);
    this.pending.set(coin, (this.pending.get(coin) ?? 0) + 1);
    return this.credit();
  }

  balance(): number {
    return this.credit();
  }

  buy(slot: string): number[] {
    const entry = this.slot(slot);
    if (entry.count === 0) throw new Error("sold out");
    const credit = this.credit();
    if (credit < entry.price) throw new Error("not enough credit");
    const avail = new Map<number, number>(
      COINS.map((c) => [
        c,
        (this.coins.get(c) ?? 0) + (this.pending.get(c) ?? 0),
      ]),
    );
    let rest = credit - entry.price;
    const change: number[] = [];
    for (const c of COINS) {
      const have = avail.get(c) ?? 0;
      const take = Math.min(Math.floor(rest / c), have);
      for (let i = 0; i < take; i++) change.push(c);
      avail.set(c, have - take);
      rest -= take * c;
    }
    if (rest !== 0) throw new Error("no exact change");
    this.coins = avail;
    this.pending = new Map(COINS.map((c) => [c, 0]));
    entry.count -= 1;
    return change;
  }

  refund(): number[] {
    const out: number[] = [];
    for (const c of COINS)
      for (let i = 0; i < (this.pending.get(c) ?? 0); i++) out.push(c);
    this.pending = new Map(COINS.map((c) => [c, 0]));
    return out;
  }

  inventory(slot: string): number {
    return this.slot(slot).count;
  }

  item(slot: string): string {
    return this.slot(slot).item;
  }

  restockCoins(coin: number, count: number): void {
    this.coin(coin);
    if (count <= 0) throw new RangeError("count must be positive");
    this.coins.set(coin, (this.coins.get(coin) ?? 0) + count);
  }

  coinStock(coin: number): number {
    this.coin(coin);
    return this.coins.get(coin) ?? 0;
  }
}
