"use strict";

function named(...names) {
  if (names.includes(""))
    throw new RangeError("stage and job names are not empty");
}

// The pipeline owns stages, a stage owns its jobs (composition); a job only names the
// jobs it needs (dependency), all in earlier stages, so a run goes in stage order.
class Pipeline {
  #stages = [];
  #jobs = new Map();
  #stageOf = new Map();
  #needs = new Map();
  #failing = new Set();
  #allowed = new Set();

  #known(job) {
    named(job);
    if (!this.#stageOf.has(job)) throw new RangeError("unknown job");
  }

  stage(name) {
    named(name);
    if (this.#jobs.has(name)) throw new RangeError("stage already exists");
    this.#stages.push(name);
    this.#jobs.set(name, []);
  }

  job(stage, name, needs) {
    named(stage, name, ...needs);
    if (!this.#jobs.has(stage)) throw new RangeError("unknown stage");
    if (new Set(needs).size !== needs.length)
      throw new RangeError("a need is listed twice");
    if (this.#stageOf.has(name)) return false;
    const earlier = this.#stages.slice(0, this.#stages.indexOf(stage));
    if (needs.some((n) => !earlier.includes(this.#stageOf.get(n))))
      return false;
    this.#jobs.get(stage).push(name);
    this.#stageOf.set(name, stage);
    this.#needs.set(name, [...needs]);
    return true;
  }

  fail(job) {
    this.#known(job);
    this.#failing.add(job);
  }

  #blocks(need, result) {
    return (
      result === "skipped" || (result === "failed" && !this.#allowed.has(need))
    );
  }

  run() {
    const outcome = new Map();
    for (const stage of this.#stages)
      for (const job of this.#jobs.get(stage)) {
        let result = this.#failing.has(job) ? "failed" : "passed";
        if (this.#needs.get(job).some((n) => this.#blocks(n, outcome.get(n))))
          result = "skipped";
        outcome.set(job, result);
      }
    return [...outcome].map(([job, result]) => `${job}: ${result}`);
  }

  removeStage(name) {
    named(name);
    const owned = this.#jobs.get(name);
    if (owned === undefined) throw new RangeError("unknown stage");
    for (const [job, needs] of this.#needs)
      if (!owned.includes(job) && needs.some((n) => owned.includes(n)))
        throw new RangeError("a later job needs this stage");
    for (const job of owned) {
      this.#stageOf.delete(job);
      this.#needs.delete(job);
      this.#failing.delete(job);
      this.#allowed.delete(job);
    }
    this.#stages.splice(this.#stages.indexOf(name), 1);
    this.#jobs.delete(name);
    return owned.length;
  }

  // The extension round: an allowed failure doesn't skip the jobs that need it.
  allowFailure(job) {
    this.#known(job);
    this.#allowed.add(job);
  }
}

module.exports = { Pipeline };
