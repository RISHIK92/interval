const MAX_PRIORITY = 1_000_000;
const MAX_MS = 1_000_000_000_000;

interface Job {
  name: string;
  priority: number;
  notBefore: number;
  seq: number;
}

// Compares two keys of equal length, element by element.
function before(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

// The contract every kind honours lives here, once: only ready jobs leave, size counts
// every job, a job leaves once, and peeking asks the same question polling does. A kind
// only says which ready job comes first, so it can't break any of that.
abstract class Queue {
  private readonly jobs = new Map<string, Job>();

  protected abstract order(job: Job): number[];

  push(job: Job): void {
    this.jobs.set(job.name, job);
  }

  peek(now: number): Job | null {
    let first: Job | null = null;
    for (const job of this.jobs.values())
      if (
        job.notBefore <= now &&
        (first === null || before(this.order(job), this.order(first)))
      )
        first = job;
    return first;
  }

  poll(now: number): Job | null {
    const job = this.peek(now);
    if (job !== null) this.jobs.delete(job.name);
    return job;
  }

  remove(name: string): boolean {
    return this.jobs.delete(name);
  }

  size(): number {
    return this.jobs.size;
  }
}

class FifoQueue extends Queue {
  protected order(job: Job): number[] {
    return [job.seq];
  }
}

class PriorityQueue extends Queue {
  protected order(job: Job): number[] {
    return [-job.priority, job.seq];
  }
}

class DelayedQueue extends Queue {
  protected order(job: Job): number[] {
    return [job.notBefore, job.seq];
  }
}

const KINDS = new Map<string, new () => Queue>([
  ["fifo", FifoQueue],
  ["priority", PriorityQueue],
  ["delayed", DelayedQueue],
]);

function time(ms: number): number {
  if (ms < 0 || ms > MAX_MS) throw new RangeError("a time is 0 to 10^12");
  return ms;
}

export class JobQueue {
  private readonly queue: Queue;
  private readonly used = new Set<string>();

  constructor(kind: string) {
    const make = KINDS.get(kind);
    if (make === undefined) throw new Error("an unknown kind");
    this.queue = new make();
  }

  push(job: string, priority: number, notBeforeMs: number): void {
    if (job === "" || this.used.has(job))
      throw new Error("a job needs a name of its own");
    if (priority < 0 || priority > MAX_PRIORITY)
      throw new RangeError("a priority is 0 to 10^6");
    const notBefore = time(notBeforeMs);
    this.queue.push({ name: job, priority, notBefore, seq: this.used.size });
    this.used.add(job);
  }

  poll(nowMs: number): string | null {
    return this.queue.poll(time(nowMs))?.name ?? null;
  }

  peekAt(nowMs: number): string | null {
    return this.queue.peek(time(nowMs))?.name ?? null;
  }

  size(): number {
    return this.queue.size();
  }

  // The extension round.
  cancel(job: string): boolean {
    if (job === "") throw new Error("an empty job");
    return this.queue.remove(job);
  }
}
