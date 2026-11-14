"use strict";

const COINS = [100, 25, 10, 5];

class VendingMachine {
  constructor() {
    this.slots = new Map();
    this.coins = new Map(COINS.map((c) => [c, 0]));
    this.pending = new Map(COINS.map((c) => [c, 0]));
  }

  slot(slot) {
    const entry = this.slots.get(slot);
    if (entry === undefined) throw new RangeError("unknown slot");
    return entry;
  }

  coin(coin) {
    if (!this.coins.has(coin)) throw new RangeError("not a coin");
  }

  credit() {
    let sum = 0;
    for (const [c, n] of this.pending) sum += c * n;
    return sum;
  }

  stock(slot, item, price, count) {
    if (slot === "" || item === "" || price <= 0 || count < 0)
      throw new RangeError("invalid stock");
    this.slots.set(slot, { item, price, count });
  }

  insert(coin) {
    this.coin(coin);
    this.pending.set(coin, this.pending.get(coin) + 1);
    return this.credit();
  }

  balance() {
    return this.credit();
  }

  buy(slot) {
    const entry = this.slot(slot);
    if (entry.count === 0) throw new Error("sold out");
    const credit = this.credit();
    if (credit < entry.price) throw new Error("not enough credit");
    const avail = new Map(
      COINS.map((c) => [c, this.coins.get(c) + this.pending.get(c)]),
    );
    let rest = credit - entry.price;
    const change = [];
    for (const c of COINS) {
      const take = Math.min(Math.floor(rest / c), avail.get(c));
      for (let i = 0; i < take; i++) change.push(c);
      avail.set(c, avail.get(c) - take);
      rest -= take * c;
    }
    if (rest !== 0) throw new Error("no exact change");
    this.coins = avail;
    this.pending = new Map(COINS.map((c) => [c, 0]));
    entry.count -= 1;
    return change;
  }

  refund() {
    const out = [];
    for (const c of COINS)
      for (let i = 0; i < this.pending.get(c); i++) out.push(c);
    this.pending = new Map(COINS.map((c) => [c, 0]));
    return out;
  }

  inventory(slot) {
    return this.slot(slot).count;
  }

  item(slot) {
    return this.slot(slot).item;
  }

  restockCoins(coin, count) {
    this.coin(coin);
    if (count <= 0) throw new RangeError("count must be positive");
    this.coins.set(coin, this.coins.get(coin) + count);
  }

  coinStock(coin) {
    this.coin(coin);
    return this.coins.get(coin);
  }
}

module.exports = { VendingMachine };
