"use strict";

const FAILED = "fail:";
const STEPS = ["create-user", "create-repo", "grant-access", "send-welcome"];
const MAX_TIMES = 1000;

// A command with its compensation. Each returns what it did, for the trail; an injected
// failure count makes the next attempts fail.
class Step {
  constructor(name) {
    this.name = name;
    this.failures = 0;
  }

  execute() {
    if (this.failures === 0) return `do:${this.name}`;
    this.failures -= 1;
    return FAILED + this.name;
  }

  compensate() {
    return `undo:${this.name}`;
  }
}

// One account's run: the steps done, in order, and everything that happened.
class Saga {
  constructor() {
    this.done = [];
    this.trail = [];
    this.status = "";
  }

  resume(steps, pivot) {
    // Done steps are skipped, so a retry carries on where the last run stopped and a
    // completed saga runs nothing.
    for (const step of steps.slice(this.done.length)) {
      const entry = step.execute();
      this.trail.push(entry);
      if (entry.startsWith(FAILED)) {
        this.failed(pivot);
        return;
      }
      this.done.push(step);
    }
    this.status = "completed";
  }

  failed(pivot) {
    if (pivot !== undefined && this.done.includes(pivot)) {
      this.status = "pending";
      return;
    }
    for (const step of [...this.done].reverse())
      this.trail.push(step.compensate());
    this.done = [];
    this.status = "compensated";
  }
}

class ProvisioningSaga {
  constructor() {
    this.steps = STEPS.map((name) => new Step(name));
    this.sagas = new Map();
    this.pivotStep = undefined;
  }

  failStep(step, times) {
    const found = this.findStep(step);
    if (times < 0 || times > MAX_TIMES)
      throw new RangeError("times runs from 0 to 1000");
    found.failures = times;
  }

  start(account) {
    if (account === "") throw new RangeError("an empty account");
    let saga = this.sagas.get(account);
    if (saga === undefined) {
      saga = new Saga();
      this.sagas.set(account, saga);
      saga.resume(this.steps, this.pivotStep);
    }
    return saga.status;
  }

  retry(account) {
    const saga = this.findSaga(account);
    saga.resume(this.steps, this.pivotStep);
    return saga.status;
  }

  trail(account) {
    return [...this.findSaga(account).trail];
  }

  status(account) {
    return this.findSaga(account).status;
  }

  // The extension round: a pivot step, past which the saga only moves forward.
  pivot(step) {
    this.pivotStep = this.findStep(step);
  }

  findStep(name) {
    const step = this.steps.find((s) => s.name === name);
    if (step === undefined) throw new RangeError("no such step");
    return step;
  }

  findSaga(account) {
    const saga = this.sagas.get(account);
    if (saga === undefined) throw new RangeError("no such account");
    return saga;
  }
}

module.exports = { ProvisioningSaga };
