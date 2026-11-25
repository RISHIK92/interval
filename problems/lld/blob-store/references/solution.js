"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Two backends with the same methods: put, latest, version, remove, keys. Callers only
// see BlobStore, so which backend is behind it never shows in their code.

// Keeps only the latest blob of each key, and counts the puts to number it.
class Plain {
  #blobs = new Map();

  put(key, data) {
    const number = (this.#blobs.get(key)?.number ?? 0) + 1;
    this.#blobs.set(key, { number, data });
    return number;
  }

  latest(key) {
    return this.#blobs.get(key)?.data ?? null;
  }

  version(key, version) {
    const found = this.#blobs.get(key);
    return found !== undefined && found.number === version ? found.data : null;
  }

  remove(key) {
    return this.#blobs.delete(key);
  }

  keys() {
    return [...this.#blobs.keys()];
  }
}

// Keeps every blob each key has had, oldest first.
class Versioned {
  #history = new Map();

  put(key, data) {
    let history = this.#history.get(key);
    if (history === undefined) {
      history = [];
      this.#history.set(key, history);
    }
    history.push(data);
    return history.length;
  }

  latest(key) {
    return this.#history.get(key)?.at(-1) ?? null;
  }

  version(key, version) {
    const history = this.#history.get(key) ?? [];
    return version <= history.length ? history[version - 1] : null;
  }

  remove(key) {
    return this.#history.delete(key);
  }

  keys() {
    return [...this.#history.keys()];
  }
}

const BACKENDS = new Map([
  ["plain", () => new Plain()],
  ["versioned", () => new Versioned()],
]);

function open(kind) {
  const made = BACKENDS.get(kind);
  if (made === undefined) throw new RangeError("unknown backend");
  return made();
}

function named(key) {
  if (key === "") throw new RangeError("keys are not empty");
}

class BlobStore {
  #kind;
  #backend;

  constructor(backend) {
    this.#backend = open(backend);
    this.#kind = backend;
  }

  putBlob(key, data) {
    named(key);
    return this.#backend.put(key, data);
  }

  fetch(key) {
    named(key);
    return this.#backend.latest(key);
  }

  remove(key) {
    named(key);
    return this.#backend.remove(key);
  }

  listKeys(prefix) {
    return this.#backend
      .keys()
      .filter((k) => k.startsWith(prefix))
      .sort(byCode);
  }

  migrate(backend) {
    if (backend === this.#kind) throw new RangeError("already on that backend");
    const target = open(backend);
    const keys = this.#backend.keys();
    for (const key of keys) target.put(key, this.#backend.latest(key));
    this.#kind = backend;
    this.#backend = target;
    return keys.length;
  }

  // The extension round: one more question for every backend, answered its own way.
  fetchVersion(key, version) {
    named(key);
    if (version < 1) throw new RangeError("versions start at 1");
    return this.#backend.version(key, version);
  }
}

module.exports = { BlobStore };
