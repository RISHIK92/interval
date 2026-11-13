"use strict";

const MAX = 1_000_000;

class OrderBook {
  constructor() {
    // Open orders per side: price -> ids in time priority, oldest first.
    this.levels = { buy: new Map(), sell: new Map() };
    // Every id ever accepted. Ids are never reused.
    this.orders = new Map();
    // The extension round: all quantity matched so far.
    this.matched = 0;
  }

  static checkSide(side) {
    if (side !== "buy" && side !== "sell")
      throw new RangeError("side must be buy or sell");
  }

  open(id) {
    const order = this.orders.get(id);
    if (order === undefined) throw new RangeError("unknown id");
    if (order.state !== "open") throw new RangeError("order is not open");
    return order;
  }

  bestOf(side) {
    const prices = [...this.levels[side].keys()];
    if (prices.length === 0) return null;
    return side === "buy" ? Math.max(...prices) : Math.min(...prices);
  }

  place(id, side, price, qty) {
    OrderBook.checkSide(side);
    if (price < 1 || price > MAX) throw new RangeError("price out of range");
    if (qty < 1 || qty > MAX) throw new RangeError("quantity out of range");
    if (id === "") throw new RangeError("empty id");
    if (this.orders.has(id)) throw new RangeError("duplicate id");
    const other = side === "buy" ? "sell" : "buy";
    const fills = [];
    for (;;) {
      const best = this.bestOf(other);
      if (qty === 0 || best === null) break;
      if ((side === "buy" && best > price) || (side === "sell" && best < price))
        break;
      const queue = this.levels[other].get(best);
      const maker = this.orders.get(queue[0]);
      const took = Math.min(qty, maker.qty);
      fills.push(`${queue[0]}:${best}:${took}`);
      qty -= took;
      maker.qty -= took;
      this.matched += took;
      if (maker.qty === 0) {
        maker.state = "filled";
        queue.shift();
        if (queue.length === 0) this.levels[other].delete(best);
      }
    }
    if (qty > 0) {
      this.orders.set(id, { side, price, qty, state: "open" });
      if (!this.levels[side].has(price)) this.levels[side].set(price, []);
      this.levels[side].get(price).push(id);
    } else {
      this.orders.set(id, { side, price, qty: 0, state: "filled" });
    }
    return fills;
  }

  cancel(id) {
    const order = this.open(id);
    const queue = this.levels[order.side].get(order.price);
    queue.splice(queue.indexOf(id), 1);
    if (queue.length === 0) this.levels[order.side].delete(order.price);
    const left = order.qty;
    order.qty = 0;
    order.state = "cancelled";
    return left;
  }

  remaining(id) {
    const order = this.orders.get(id);
    if (order === undefined || order.state !== "open") return null;
    return order.qty;
  }

  best(side) {
    OrderBook.checkSide(side);
    return this.bestOf(side);
  }

  depth(side, levels) {
    OrderBook.checkSide(side);
    if (levels < 0) throw new RangeError("negative levels");
    const prices = [...this.levels[side].keys()].sort((a, b) =>
      side === "buy" ? b - a : a - b,
    );
    const out = [];
    for (const p of prices.slice(0, levels)) {
      out.push(p);
      out.push(
        this.levels[side]
          .get(p)
          .reduce((sum, i) => sum + this.orders.get(i).qty, 0),
      );
    }
    return out;
  }

  modify(id, qty) {
    const order = this.open(id);
    if (qty < 1 || qty > MAX) throw new RangeError("quantity out of range");
    if (qty > order.qty) {
      // Growing an order costs its place in the queue.
      const queue = this.levels[order.side].get(order.price);
      queue.splice(queue.indexOf(id), 1);
      queue.push(id);
    }
    order.qty = qty;
  }

  traded() {
    return this.matched;
  }
}

module.exports = { OrderBook };
