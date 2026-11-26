"use strict";

const MAX_SAMPLE_EVERY = 1000;

function given(value) {
  if (value === "") throw new RangeError("empty name");
}

// A sampled trace: spans get ids from 1, and each one is recorded when it ends.
class RecordingTrace {
  #open = new Map();
  #started = 0;
  #recorded = [];

  span(name) {
    this.#started += 1;
    this.#open.set(this.#started, name);
    return this.#started;
  }

  endSpan(spanId) {
    const name = this.#open.get(spanId);
    if (name === undefined) return false;
    this.#open.delete(spanId);
    this.#recorded.push(`${spanId} ${name}`);
    return true;
  }

  recorded() {
    return [...this.#recorded];
  }

  sampled() {
    return this;
  }
}

// The null object: the same methods as a recording trace, and they never refuse and
// record nothing, so callers never check whether a trace is sampled.
class NoopTrace {
  span() {
    return 0;
  }

  endSpan() {
    return true;
  }

  recorded() {
    return [];
  }

  sampled() {
    return new RecordingTrace();
  }
}

// Samples one trace in every sampleEvery. The tracer checks arguments the same way for
// every trace, then hands the call to the trace, recording or not.
class Tracer {
  #every;
  #traces = new Map();

  constructor(sampleEvery) {
    if (sampleEvery < 1 || sampleEvery > MAX_SAMPLE_EVERY)
      throw new RangeError("bad sampling rate");
    this.#every = sampleEvery;
  }

  startTrace(name) {
    given(name);
    const started = this.#traces.size;
    const trace = `${name}#${started + 1}`;
    this.#traces.set(
      trace,
      started % this.#every === 0 ? new RecordingTrace() : new NoopTrace(),
    );
    return trace;
  }

  span(trace, name) {
    const found = this.#trace(trace);
    given(name);
    return found.span(name);
  }

  endSpan(trace, spanId) {
    return this.#trace(trace).endSpan(spanId);
  }

  recorded(trace) {
    return this.#trace(trace).recorded();
  }

  // The extension round: sampling a trace that wasn't.
  forceSample(trace) {
    this.#traces.set(trace, this.#trace(trace).sampled());
  }

  #trace(trace) {
    const found = this.#traces.get(trace);
    if (found === undefined) throw new RangeError("unknown trace");
    return found;
  }
}

module.exports = { Tracer };
