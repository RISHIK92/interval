// The abstraction the sender depends on. A transport delivers one message and returns its
// receipt, or null when the send failed; how it delivers is its own business.
abstract class Transport {
  private failures = 0;

  send(id: string, payload: string): string | null {
    if (this.failures > 0) {
      this.failures -= 1;
      return null;
    }
    return this.deliver(id, payload);
  }

  planFailures(n: number): void {
    this.failures = n;
  }

  protected abstract deliver(id: string, payload: string): string;
}

class Http extends Transport {
  protected deliver(id: string, payload: string): string {
    return `POST ${id} ${payload}`;
  }
}

class Queue extends Transport {
  protected deliver(id: string, payload: string): string {
    return `PUBLISH ${id} ${payload}`;
  }
}

class Email extends Transport {
  protected deliver(id: string, payload: string): string {
    return `MAIL ${id} ${payload}`;
  }
}

const TRANSPORTS = new Map<string, () => Transport>([
  ["http", () => new Http()],
  ["queue", () => new Queue()],
  ["email", () => new Email()],
]);

function transportNamed(name: string): Transport {
  const made = TRANSPORTS.get(name);
  if (made === undefined) throw new RangeError("unknown transport");
  return made();
}

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

interface Message {
  readonly id: string;
  readonly payload: string;
  failed: number;
}

// Business code only ever writes to the outbox. Which transport delivers is chosen by
// name from a registry and can be replaced while messages wait, without the outbox changing.
export class OutboxSender {
  private name: string;
  private transport: Transport;
  private queued: Message[] = [];
  private readonly seen = new Set<string>();
  private limit: number | null = null;
  private readonly dead: string[] = [];

  constructor(transport: string) {
    this.transport = transportNamed(transport);
    this.name = transport;
  }

  enqueue(id: string, payload: string): boolean {
    given(id);
    given(payload);
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.queued.push({ id, payload, failed: 0 });
    return true;
  }

  flush(): string[] {
    const receipts: string[] = [];
    const waiting: Message[] = [];
    for (const message of this.queued) {
      const receipt = this.transport.send(message.id, message.payload);
      if (receipt !== null) {
        receipts.push(receipt);
        continue;
      }
      message.failed += 1;
      if (this.limit !== null && message.failed >= this.limit)
        this.dead.push(message.id);
      else waiting.push(message);
    }
    this.queued = waiting;
    return receipts;
  }

  failNext(n: number): void {
    if (n < 0) throw new RangeError("negative count");
    this.transport.planFailures(n);
  }

  swapTransport(transport: string): void {
    if (transport === this.name) throw new RangeError("already in use");
    this.transport = transportNamed(transport);
    this.name = transport;
  }

  pending(): number {
    return this.queued.length;
  }

  // The extension round: a limit on retries, and somewhere for the hopeless to go.
  maxAttempts(n: number): void {
    if (n < 1) throw new RangeError("at least one attempt");
    this.limit = n;
  }

  deadLetters(): string[] {
    return [...this.dead];
  }
}
