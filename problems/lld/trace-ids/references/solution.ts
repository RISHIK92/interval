const MAX_NODE = 1023;
const MAX_MS = 1_000_000_000_000;
const PER_MS = 1000; // sequences 000 to 999 in one millisecond
const WIDTHS = [13, 4, 3]; // timestamp, node, sequence

// The process's one ID source. Every caller shares this instance, so the last timestamp
// and its sequence live here and nowhere else: two sources on one node could issue the
// same ID, which is why there is only ever one.
export class TraceIds {
  private readonly node: number;
  private ms = -1;
  private sequence = 0;
  private count = 0;

  constructor(nodeId: number) {
    if (nodeId < 0 || nodeId > MAX_NODE)
      throw new RangeError("node out of range");
    this.node = nodeId;
  }

  nextId(nowMs: number): string {
    if (nowMs < 0 || nowMs > MAX_MS) throw new RangeError("time out of range");
    if (nowMs > this.ms) {
      this.ms = nowMs;
      this.sequence = 0;
    } else if (this.sequence + 1 < PER_MS) {
      // The same millisecond, or a clock that went backwards: stay on the last one.
      this.sequence += 1;
    } else {
      // A full millisecond borrows the next one, so IDs keep sorting in issue order.
      this.ms += 1;
      this.sequence = 0;
    }
    this.count += 1;
    return [this.ms, this.node, this.sequence]
      .map((part, i) => String(part).padStart(WIDTHS[i] ?? 0, "0"))
      .join("-");
  }

  issued(): number {
    return this.count;
  }

  lastMs(): number {
    return this.ms;
  }

  // The extension round: reading an ID back.
  decode(traceId: string): number[] {
    const parts = traceId.split("-");
    if (
      parts.length !== WIDTHS.length ||
      parts.some((p, i) => p.length !== WIDTHS[i] || !/^[0-9]+$/.test(p))
    )
      throw new RangeError("not a trace ID");
    const values = parts.map(Number);
    if ((values[1] ?? 0) > MAX_NODE) throw new RangeError("node out of range");
    return values;
  }
}
