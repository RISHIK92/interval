"use strict";

function named(name) {
  if (name === "") throw new RangeError("check names are not empty");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Callers tell the gate what happened and ask it one question, "may I deploy?". Which
// checks are required, what they last reported and which are waived stay inside.
class DeployGate {
  #required = new Set();
  #passed = new Map(); // each check's latest report
  #waived = new Map(); // check -> reason

  require(check) {
    named(check);
    this.#required.add(check);
  }

  report(check, passed) {
    named(check);
    this.#passed.set(check, passed);
  }

  #blocks(check) {
    return !this.#waived.has(check) && this.#passed.get(check) !== true;
  }

  mayDeploy() {
    return ![...this.#required].some((c) => this.#blocks(c));
  }

  blockers() {
    return [...this.#required].filter((c) => this.#blocks(c)).sort(byCode);
  }

  // The extension round: a waived check never blocks.
  waive(check, reason) {
    named(check);
    if (reason === "") throw new RangeError("a waiver has a reason");
    if (!this.#required.has(check))
      throw new RangeError("only a required check is waived");
    this.#waived.set(check, reason);
  }

  waivers() {
    return [...this.#waived.keys()]
      .sort(byCode)
      .map((c) => `${c}: ${this.#waived.get(c)}`);
  }
}

module.exports = { DeployGate };
