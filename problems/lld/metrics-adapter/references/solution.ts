// The legacy agent's units, each as how many of the new API's base units it is.
const TIME_UNITS = new Map([
  ["s", 1000],
  ["ms", 1],
  ["us", 0.001],
]);
const SIZE_UNITS = new Map([
  ["B", 1],
  ["KB", 1024],
  ["MB", 1024 * 1024],
]);

// The new metrics API: it knows only milliseconds and bytes, and each name is one or the
// other.
class MetricsApi {
  private readonly msByName = new Map<string, number>();
  private readonly bytesByName = new Map<string, number>();

  recordMs(name: string, ms: number): boolean {
    if (this.bytesByName.has(name)) return false;
    this.msByName.set(name, ms);
    return true;
  }

  recordBytes(name: string, size: number): boolean {
    if (this.msByName.has(name)) return false;
    this.bytesByName.set(name, size);
    return true;
  }

  ms(name: string): number | null {
    return this.msByName.get(name) ?? null;
  }

  size(name: string): number | null {
    return this.bytesByName.get(name) ?? null;
  }

  names(): string[] {
    return [...this.msByName.keys(), ...this.bytesByName.keys()].sort();
  }
}

function named(name: string): void {
  if (name === "") throw new RangeError("empty name");
}

// Speaks the legacy agent's `name value unit` lines and feeds the new API: the only code
// that knows the old format and units.
export class MetricsAdapter {
  private readonly api = new MetricsApi();

  ingestLegacy(line: string): boolean {
    if (line === "") throw new RangeError("empty line");
    return this.ingest(line);
  }

  gaugeMs(name: string): number | null {
    named(name);
    return this.api.ms(name);
  }

  gaugeBytes(name: string): number | null {
    named(name);
    return this.api.size(name);
  }

  names(): string[] {
    return this.api.names();
  }

  // The extension round: a batch of lines, each as ingestLegacy takes it.
  ingestBatch(lines: string[]): number {
    return lines.filter((line) => this.ingest(line)).length;
  }

  private ingest(line: string): boolean {
    const fields = line.split(" ");
    if (fields.length !== 3) return false;
    const [name, text, unit] = fields as [string, string, string];
    if (name === "" || !/^[0-9]{1,9}$/.test(text)) return false;
    const value = Number(text);
    const ms = TIME_UNITS.get(unit);
    if (ms !== undefined) return this.api.recordMs(name, value * ms);
    const bytes = SIZE_UNITS.get(unit);
    if (bytes !== undefined) return this.api.recordBytes(name, value * bytes);
    return false;
  }
}
