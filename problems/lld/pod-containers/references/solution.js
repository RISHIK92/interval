"use strict";

function named(...names) {
  if (names.includes(""))
    throw new RangeError("names and images are not empty");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A pod owns its containers: they are created inside it and go with it.
class PodRegistry {
  #pods = new Map();
  #podOf = new Map();
  #sidecars = new Map();

  createPod(pod) {
    named(pod);
    if (this.#pods.has(pod)) throw new RangeError("pod already exists");
    const injected = [...this.#sidecars].map(([name, image]) => [
      `${pod}-${name}`,
      image,
    ]);
    if (injected.some(([name]) => this.#podOf.has(name)))
      throw new RangeError("a sidecar's name is taken");
    this.#pods.set(pod, new Map());
    for (const [name, image] of injected) this.#place(pod, name, image);
  }

  #place(pod, container, image) {
    this.#pods.get(pod).set(container, image);
    this.#podOf.set(container, pod);
  }

  addContainer(pod, container, image) {
    named(pod, container, image);
    if (!this.#pods.has(pod) || this.#podOf.has(container)) return false;
    this.#place(pod, container, image);
    return true;
  }

  removePod(pod) {
    named(pod);
    const owned = this.#pods.get(pod);
    if (owned === undefined) throw new RangeError("unknown pod");
    this.#pods.delete(pod);
    for (const container of owned.keys()) this.#podOf.delete(container);
    return owned.size;
  }

  podOf(container) {
    named(container);
    return this.#podOf.get(container) ?? null;
  }

  images() {
    const all = new Set();
    for (const owned of this.#pods.values())
      for (const image of owned.values()) all.add(image);
    return [...all].sort(byCode);
  }

  // The extension round: containers injected into every pod created afterwards.
  sidecar(container, image) {
    named(container, image);
    if (this.#sidecars.has(container))
      throw new RangeError("sidecar already registered");
    this.#sidecars.set(container, image);
  }
}

module.exports = { PodRegistry };
