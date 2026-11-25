"use strict";

const MAX_CAPACITY = 1_000;

// A FIFO queue with stated contracts. Class invariant, true after every call: it holds
// at most `capacity` items. A ring of `capacity` slots, so taking is O(1).
class WorkQueue {
  #slots;
  #head = 0;
  #count = 0;

  // Precondition: a capacity from 1 to 10^3.
  constructor(capacity) {
    if (capacity < 1 || capacity > MAX_CAPACITY)
      throw new RangeError("capacity is from 1 to 10^3");
    this.#slots = new Array(capacity).fill("");
  }

  // Precondition: a non-empty item. Postcondition: true with the item at the back, or
  // false with nothing changed when the queue is full.
  offer(item) {
    if (item === "") throw new RangeError("an item is not empty");
    if (this.#count === this.#slots.length) return false;
    this.#slots[(this.#head + this.#count) % this.#slots.length] = item;
    this.#count++;
    return true;
  }

  // Precondition: the queue isn't empty. Postcondition: the oldest item, removed.
  take() {
    if (this.#count === 0) throw new RangeError("the queue is empty");
    const item = this.#slots[this.#head];
    this.#head = (this.#head + 1) % this.#slots.length;
    this.#count--;
    return item;
  }

  // No precondition, and it never changes anything.
  peekNext() {
    return this.#count > 0 ? this.#slots[this.#head] : null;
  }

  size() {
    return this.#count;
  }
}

module.exports = { WorkQueue };
