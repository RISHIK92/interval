"use strict";

// Stands in for the remote vault: each round trip is counted, and a rotation issues the
// next version of a secret.
class Vault {
  #versions = new Map();
  trips = 0;

  constructor(names) {
    for (const name of names) this.#versions.set(name, 1);
  }

  holds(name) {
    return this.#versions.has(name);
  }

  fetch(names) {
    this.trips += 1;
    return names.map((name) => [name, `${name}#${this.#versions.get(name)}`]);
  }

  rotate(name) {
    this.#versions.set(name, this.#versions.get(name) + 1);
  }
}

class SecretLoader {
  #vault;
  // A name is here only between its fetch and its next rotation.
  #cache = new Map();

  constructor(names) {
    if (names.includes("")) throw new RangeError("names are not empty");
    if (new Set(names).size < names.length)
      throw new RangeError("names are unique");
    this.#vault = new Vault(names);
  }

  #known(name) {
    if (!this.#vault.holds(name)) throw new RangeError("unknown secret");
  }

  reveal(name) {
    this.#known(name);
    if (!this.#cache.has(name)) {
      for (const [n, secret] of this.#vault.fetch([name]))
        this.#cache.set(n, secret);
    }
    return this.#cache.get(name);
  }

  fetches() {
    return this.#vault.trips;
  }

  rotate(name) {
    this.#known(name);
    this.#vault.rotate(name);
    this.#cache.delete(name);
  }

  // The extension round: warm several secrets with one round trip.
  prefetch(names) {
    for (const name of names) this.#known(name);
    const cold = [...new Set(names)].filter((name) => !this.#cache.has(name));
    if (cold.length > 0) {
      for (const [n, secret] of this.#vault.fetch(cold))
        this.#cache.set(n, secret);
    }
    return cold.length;
  }
}

module.exports = { SecretLoader };
