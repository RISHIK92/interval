const MAX_SAMPLE_EVERY = 1000;

function given(value: string): void {
  if (value === "") throw new RangeError("empty name");
}

interface Trace {
  span(name: string): number;
  endSpan(spanId: number): boolean;
  recorded(): string[];
  // The trace that records from now on: itself if it already does.
  sampled(): Trace;
}

// A sampled trace: spans get ids from 1, and each one is recorded when it ends.
class RecordingTrace implements Trace {
  private readonly open = new Map<number, string>();
  private started = 0;
  private readonly ended: string[] = [];

  span(name: string): number {
    this.started += 1;
    this.open.set(this.started, name);
    return this.started;
  }

  endSpan(spanId: number): boolean {
    const name = this.open.get(spanId);
    if (name === undefined) return false;
    this.open.delete(spanId);
    this.ended.push(`${String(spanId)} ${name}`);
    return true;
  }

  recorded(): string[] {
    return [...this.ended];
  }

  sampled(): Trace {
    return this;
  }
}

// The null object: the same methods as a recording trace, and they never refuse and
// record nothing, so callers never check whether a trace is sampled.
class NoopTrace implements Trace {
  span(): number {
    return 0;
  }

  endSpan(): boolean {
    return true;
  }

  recorded(): string[] {
    return [];
  }

  sampled(): Trace {
    return new RecordingTrace();
  }
}

// Samples one trace in every sampleEvery. The tracer checks arguments the same way for
// every trace, then hands the call to the trace, recording or not.
export class Tracer {
  private readonly every: number;
  private readonly traces = new Map<string, Trace>();

  constructor(sampleEvery: number) {
    if (sampleEvery < 1 || sampleEvery > MAX_SAMPLE_EVERY)
      throw new RangeError("bad sampling rate");
    this.every = sampleEvery;
  }

  startTrace(name: string): string {
    given(name);
    const started = this.traces.size;
    const trace = `${name}#${String(started + 1)}`;
    this.traces.set(
      trace,
      started % this.every === 0 ? new RecordingTrace() : new NoopTrace(),
    );
    return trace;
  }

  span(trace: string, name: string): number {
    const found = this.trace(trace);
    given(name);
    return found.span(name);
  }

  endSpan(trace: string, spanId: number): boolean {
    return this.trace(trace).endSpan(spanId);
  }

  recorded(trace: string): string[] {
    return this.trace(trace).recorded();
  }

  // The extension round: sampling a trace that wasn't.
  forceSample(trace: string): void {
    this.traces.set(trace, this.trace(trace).sampled());
  }

  private trace(trace: string): Trace {
    const found = this.traces.get(trace);
    if (found === undefined) throw new RangeError("unknown trace");
    return found;
  }
}
