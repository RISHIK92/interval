const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// What the store needs from where blobs are kept. Callers only see BlobStore, so which
// backend is behind it never shows in their code.
interface Backend {
  put(key: string, data: string): number;
  latest(key: string): string | null;
  version(key: string, version: number): string | null;
  remove(key: string): boolean;
  keys(): string[];
}

// Keeps only the latest blob of each key, and counts the puts to number it.
class Plain implements Backend {
  private readonly blobs = new Map<string, { number: number; data: string }>();

  put(key: string, data: string): number {
    const number = (this.blobs.get(key)?.number ?? 0) + 1;
    this.blobs.set(key, { number, data });
    return number;
  }

  latest(key: string): string | null {
    return this.blobs.get(key)?.data ?? null;
  }

  version(key: string, version: number): string | null {
    const found = this.blobs.get(key);
    return found !== undefined && found.number === version ? found.data : null;
  }

  remove(key: string): boolean {
    return this.blobs.delete(key);
  }

  keys(): string[] {
    return [...this.blobs.keys()];
  }
}

// Keeps every blob each key has had, oldest first.
class Versioned implements Backend {
  private readonly history = new Map<string, string[]>();

  put(key: string, data: string): number {
    let history = this.history.get(key);
    if (history === undefined) {
      history = [];
      this.history.set(key, history);
    }
    history.push(data);
    return history.length;
  }

  latest(key: string): string | null {
    return this.history.get(key)?.at(-1) ?? null;
  }

  version(key: string, version: number): string | null {
    return this.history.get(key)?.[version - 1] ?? null;
  }

  remove(key: string): boolean {
    return this.history.delete(key);
  }

  keys(): string[] {
    return [...this.history.keys()];
  }
}

const BACKENDS = new Map<string, () => Backend>([
  ["plain", () => new Plain()],
  ["versioned", () => new Versioned()],
]);

function open(kind: string): Backend {
  const made = BACKENDS.get(kind);
  if (made === undefined) throw new RangeError("unknown backend");
  return made();
}

function named(key: string): void {
  if (key === "") throw new RangeError("keys are not empty");
}

export class BlobStore {
  private kind: string;
  private backend: Backend;

  constructor(backend: string) {
    this.backend = open(backend);
    this.kind = backend;
  }

  putBlob(key: string, data: string): number {
    named(key);
    return this.backend.put(key, data);
  }

  fetch(key: string): string | null {
    named(key);
    return this.backend.latest(key);
  }

  remove(key: string): boolean {
    named(key);
    return this.backend.remove(key);
  }

  listKeys(prefix: string): string[] {
    return this.backend
      .keys()
      .filter((k) => k.startsWith(prefix))
      .sort(byCode);
  }

  migrate(backend: string): number {
    if (backend === this.kind) throw new RangeError("already on that backend");
    const target = open(backend);
    const keys = this.backend.keys();
    // Every listed key has a latest blob; the fallback only satisfies the type.
    for (const key of keys) target.put(key, this.backend.latest(key) ?? "");
    this.kind = backend;
    this.backend = target;
    return keys.length;
  }

  // The extension round: one more question for every backend, answered its own way.
  fetchVersion(key: string, version: number): string | null {
    named(key);
    if (version < 1) throw new RangeError("versions start at 1");
    return this.backend.version(key, version);
  }
}
