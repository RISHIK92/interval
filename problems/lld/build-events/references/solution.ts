const EVENTS = new Set(["queued", "started", "passed", "failed"]);

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

function checkEvent(event: string): void {
  if (!EVENTS.has(event)) throw new RangeError("unknown event");
}

// An observer: it takes delivery of the events it chose. While paused it keeps them
// back, in order, until it's resumed.
class Subscriber {
  readonly name: string;
  readonly events: ReadonlySet<string>;
  readonly inbox: string[] = [];
  kept: string[] | null = null;

  constructor(name: string, events: readonly string[]) {
    this.name = name;
    this.events = new Set(events);
  }

  // Whether the delivery reached the inbox now (not kept back).
  update(delivery: string): boolean {
    if (this.kept !== null) this.kept.push(delivery);
    else this.inbox.push(delivery);
    return this.kept === null;
  }
}

// The subject: it updates every subscriber that chose the event, in the order they
// subscribed, and knows nothing else about them.
export class BuildEvents {
  private readonly subscribers = new Map<string, Subscriber>();

  subscribe(subscriber: string, events: string[]): void {
    given(subscriber);
    if (events.length === 0 || new Set(events).size !== events.length)
      throw new RangeError("no events, or one listed twice");
    events.forEach(checkEvent);
    if (this.subscribers.has(subscriber))
      throw new RangeError("already subscribed");
    this.subscribers.set(subscriber, new Subscriber(subscriber, events));
  }

  unsubscribe(subscriber: string): boolean {
    given(subscriber);
    return this.subscribers.delete(subscriber);
  }

  publish(event: string, build: string): string[] {
    checkEvent(event);
    given(build);
    const delivered: string[] = [];
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.events.has(event)) continue;
      if (subscriber.update(`${build} ${event}`))
        delivered.push(subscriber.name);
    }
    return delivered;
  }

  inbox(subscriber: string): string[] {
    return [...this.subscriber(subscriber).inbox];
  }

  // The extension round: holding deliveries back.
  pause(subscriber: string): void {
    const found = this.subscriber(subscriber);
    if (found.kept !== null) throw new RangeError("already paused");
    found.kept = [];
  }

  resume(subscriber: string): number {
    const found = this.subscriber(subscriber);
    if (found.kept === null) throw new RangeError("not paused");
    found.inbox.push(...found.kept);
    const delivered = found.kept.length;
    found.kept = null;
    return delivered;
  }

  private subscriber(subscriber: string): Subscriber {
    const found = this.subscribers.get(subscriber);
    if (found === undefined) throw new RangeError("not subscribed");
    return found;
  }
}
