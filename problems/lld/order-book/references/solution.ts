type Side = "buy" | "sell";
type Order = {
  side: Side;
  price: number;
  qty: number;
  state: "open" | "filled" | "cancelled";
};

const MAX = 1_000_000;

export class OrderBook {
  // Open orders per side: price -> ids in time priority, oldest first.
  private readonly levels: Record<Side, Map<number, string[]>> = {
    buy: new Map(),
    sell: new Map(),
  };
  // Every id ever accepted. Ids are never reused.
  private readonly orders = new Map<string, Order>();
  // The extension round: all quantity matched so far.
  private matched = 0;

  private static checkSide(side: string): Side {
    if (side !== "buy" && side !== "sell")
      throw new RangeError("side must be buy or sell");
    return side;
  }

  private open(id: string): Order {
    const order = this.orders.get(id);
    if (order === undefined) throw new RangeError("unknown id");
    if (order.state !== "open") throw new RangeError("order is not open");
    return order;
  }

  private bestOf(side: Side): number | null {
    const prices = [...this.levels[side].keys()];
    if (prices.length === 0) return null;
    return side === "buy" ? Math.max(...prices) : Math.min(...prices);
  }

  private queueOf(order: Order): string[] {
    const queue = this.levels[order.side].get(order.price);
    if (queue === undefined) throw new Error("open order without a level");
    return queue;
  }

  place(id: string, sideName: string, price: number, qty: number): string[] {
    const side = OrderBook.checkSide(sideName);
    if (price < 1 || price > MAX) throw new RangeError("price out of range");
    if (qty < 1 || qty > MAX) throw new RangeError("quantity out of range");
    if (id === "") throw new RangeError("empty id");
    if (this.orders.has(id)) throw new RangeError("duplicate id");
    const other: Side = side === "buy" ? "sell" : "buy";
    const fills: string[] = [];
    for (;;) {
      const best = this.bestOf(other);
      if (qty === 0 || best === null) break;
      if ((side === "buy" && best > price) || (side === "sell" && best < price))
        break;
      const queue = this.levels[other].get(best) ?? [];
      const makerId = queue[0] ?? "";
      const maker = this.orders.get(makerId);
      if (maker === undefined) throw new Error("level without an order");
      const took = Math.min(qty, maker.qty);
      fills.push(`${makerId}:${String(best)}:${String(took)}`);
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
      const queue = this.levels[side].get(price) ?? [];
      queue.push(id);
      this.levels[side].set(price, queue);
    } else {
      this.orders.set(id, { side, price, qty: 0, state: "filled" });
    }
    return fills;
  }

  cancel(id: string): number {
    const order = this.open(id);
    const queue = this.queueOf(order);
    queue.splice(queue.indexOf(id), 1);
    if (queue.length === 0) this.levels[order.side].delete(order.price);
    const left = order.qty;
    order.qty = 0;
    order.state = "cancelled";
    return left;
  }

  remaining(id: string): number | null {
    const order = this.orders.get(id);
    if (order === undefined || order.state !== "open") return null;
    return order.qty;
  }

  best(sideName: string): number | null {
    return this.bestOf(OrderBook.checkSide(sideName));
  }

  depth(sideName: string, levels: number): number[] {
    const side = OrderBook.checkSide(sideName);
    if (levels < 0) throw new RangeError("negative levels");
    const prices = [...this.levels[side].keys()].sort((a, b) =>
      side === "buy" ? b - a : a - b,
    );
    const out: number[] = [];
    for (const p of prices.slice(0, levels)) {
      out.push(p);
      out.push(
        (this.levels[side].get(p) ?? []).reduce(
          (sum, i) => sum + (this.orders.get(i)?.qty ?? 0),
          0,
        ),
      );
    }
    return out;
  }

  modify(id: string, qty: number): void {
    const order = this.open(id);
    if (qty < 1 || qty > MAX) throw new RangeError("quantity out of range");
    if (qty > order.qty) {
      // Growing an order costs its place in the queue.
      const queue = this.queueOf(order);
      queue.splice(queue.indexOf(id), 1);
      queue.push(id);
    }
    order.qty = qty;
  }

  traded(): number {
    return this.matched;
  }
}
