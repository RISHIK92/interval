"use strict";

const MAX_QTY = 1e9;

function named(...names) {
  if (names.includes(""))
    throw new RangeError("skus and order ids are not empty");
}

function counted(qty) {
  if (qty < 1 || qty > MAX_QTY)
    throw new RangeError("qty must be within 1 and 10^9");
}

// On hand = available + reserved, per SKU, after every call: the two maps change
// together and only here.
class Warehouse {
  #onHand = new Map();
  #reserved = new Map();
  #open = new Map();
  #used = new Set();

  receive(sku, qty) {
    named(sku);
    counted(qty);
    const now = (this.#onHand.get(sku) ?? 0) + qty;
    this.#onHand.set(sku, now);
    return now;
  }

  reserve(orderId, sku, qty) {
    named(orderId, sku);
    counted(qty);
    if (this.#used.has(orderId)) throw new RangeError("order id already used");
    if (qty > this.available(sku)) return false;
    this.#used.add(orderId);
    this.#open.set(orderId, { sku, qty });
    this.#reserved.set(sku, (this.#reserved.get(sku) ?? 0) + qty);
    return true;
  }

  #close(orderId) {
    named(orderId);
    const order = this.#open.get(orderId);
    if (order === undefined) return undefined;
    this.#open.delete(orderId);
    this.#reserved.set(order.sku, this.#reserved.get(order.sku) - order.qty);
    return order;
  }

  ship(orderId) {
    const order = this.#close(orderId);
    if (order === undefined) return false;
    this.#onHand.set(order.sku, this.#onHand.get(order.sku) - order.qty);
    return true;
  }

  cancel(orderId) {
    return this.#close(orderId) !== undefined;
  }

  available(sku) {
    named(sku);
    return (this.#onHand.get(sku) ?? 0) - (this.#reserved.get(sku) ?? 0);
  }

  // The extension round: damaged stock leaves, but only from what's available.
  writeOff(sku, qty) {
    counted(qty);
    if (qty > this.available(sku)) return false;
    this.#onHand.set(sku, this.#onHand.get(sku) - qty);
    return true;
  }
}

module.exports = { Warehouse };
