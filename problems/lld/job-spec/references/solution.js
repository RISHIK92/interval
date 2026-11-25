"use strict";

const KEY = /^[A-Z][A-Z0-9_]*$/;

function checkedKey(key) {
  if (!KEY.test(key)) throw new RangeError("an env key is upper snake case");
  return key;
}

class JobSpec {
  #name;
  #steps = [];
  // key -> { value, secret }
  #env = new Map();

  constructor(name) {
    if (name === "") throw new RangeError("a job needs a name");
    this.#name = name;
  }

  addStep(command) {
    if (command === "") throw new RangeError("a step needs a command");
    this.#steps.push(command);
    return this.#steps.length;
  }

  setEnv(key, value) {
    this.#env.set(checkedKey(key), { value, secret: false });
  }

  render() {
    const keys = [...this.#env.keys()].sort();
    return [
      `job ${this.#name}`,
      ...keys.map((key) => {
        const { value, secret } = this.#env.get(key);
        return `env ${key}=${secret ? "***" : value}`;
      }),
      ...this.#steps.map((command, i) => `step ${i + 1}: ${command}`),
    ];
  }

  stepCount() {
    return this.#steps.length;
  }

  // The extension round.
  secret(key, value) {
    this.#env.set(checkedKey(key), { value, secret: true });
  }
}

module.exports = { JobSpec };
