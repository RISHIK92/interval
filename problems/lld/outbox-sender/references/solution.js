"use strict";

// The abstraction the sender depends on. A transport delivers one message and returns its
// receipt, or null when the send failed; how it delivers is each subclass's deliver.
class Transport {
  #failures = 0;

  send(id, payload) {
    if (this.#failures > 0) {
      this.#failures -= 1;
      return null;
    }
    return this.deliver(id, payload);
  }

  planFailures(n) {
    this.#failures = n;
  }
}

class Http extends Transport {
  deliver(id, payload) {
    return `POST ${id} ${payload}`;
  }
}

class Queue extends Transport {
  deliver(id, payload) {
    return `PUBLISH ${id} ${payload}`;
  }
}

class Email extends Transport {
  deliver(id, payload) {
    return `MAIL ${id} ${payload}`;
  }
}

const TRANSPORTS = new Map([
  ["http", () => new Http()],
  ["queue", () => new Queue()],
  ["email", () => new Email()],
]);

function transportNamed(name) {
  const made = TRANSPORTS.get(name);
  if (made === undefined) throw new RangeError("unknown transport");
  return made();
}

function given(value) {
  if (value === "") throw new RangeError("empty");
}

// Business code only ever writes to the outbox. Which transport delivers is chosen by
// name from a registry and can be replaced while messages wait, without the outbox changing.
class OutboxSender {
  #name;
  #transport;
  #queued = [];
  #seen = new Set();
  #limit = null;
  #dead = [];

  constructor(transport) {
    this.#transport = transportNamed(transport);
    this.#name = transport;
  }

  enqueue(id, payload) {
    given(id);
    given(payload);
    if (this.#seen.has(id)) return false;
    this.#seen.add(id);
    this.#queued.push({ id, payload, failed: 0 });
    return true;
  }

  flush() {
    const receipts = [];
    const waiting = [];
    for (const message of this.#queued) {
      const receipt = this.#transport.send(message.id, message.payload);
      if (receipt !== null) {
        receipts.push(receipt);
        continue;
      }
      message.failed += 1;
      if (this.#limit !== null && message.failed >= this.#limit)
        this.#dead.push(message.id);
      else waiting.push(message);
    }
    this.#queued = waiting;
    return receipts;
  }

  failNext(n) {
    if (n < 0) throw new RangeError("negative count");
    this.#transport.planFailures(n);
  }

  swapTransport(transport) {
    if (transport === this.#name) throw new RangeError("already in use");
    this.#transport = transportNamed(transport);
    this.#name = transport;
  }

  pending() {
    return this.#queued.length;
  }

  // The extension round: a limit on retries, and somewhere for the hopeless to go.
  maxAttempts(n) {
    if (n < 1) throw new RangeError("at least one attempt");
    this.#limit = n;
  }

  deadLetters() {
    return [...this.#dead];
  }
}

module.exports = { OutboxSender };
