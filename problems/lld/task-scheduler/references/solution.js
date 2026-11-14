"use strict";

class TaskScheduler {
  constructor() {
    // Insertion order is the order of adding, which breaks priority ties.
    // id -> { priority, deps, state }, state one of queued, running, done, cancelled.
    this.tasks = new Map();
  }

  isReady(task) {
    return (
      task.state === "queued" &&
      task.deps.every((d) => this.tasks.get(d).state === "done")
    );
  }

  add(id, priority, deps) {
    if (this.tasks.has(id)) throw new Error("duplicate id");
    if (deps.some((d) => !this.tasks.has(d)))
      throw new Error("unknown dependency");
    this.tasks.set(id, { priority, deps: [...deps], state: "queued" });
  }

  next() {
    let best = null;
    for (const [id, task] of this.tasks) {
      // Strictly greater, so the earliest added keeps a tie.
      if (
        this.isReady(task) &&
        (best === null || task.priority > this.tasks.get(best).priority)
      )
        best = id;
    }
    if (best !== null) this.tasks.get(best).state = "running";
    return best;
  }

  complete(id) {
    const task = this.tasks.get(id);
    if (task === undefined || task.state !== "running")
      throw new Error("not running");
    task.state = "done";
  }

  status(id) {
    const task = this.tasks.get(id);
    if (task === undefined) throw new Error("unknown id");
    if (task.state === "queued")
      return this.isReady(task) ? "ready" : "waiting";
    return task.state;
  }

  // The extension round.
  cancel(id) {
    const task = this.tasks.get(id);
    if (task === undefined) throw new Error("unknown id");
    if (task.state === "done") throw new Error("already done");
    if (task.state === "cancelled") return 0;
    // Dependencies are always added first, so one pass in order finds every dependent.
    const gone = new Set([id]);
    task.state = "cancelled";
    for (const [other, t] of this.tasks) {
      if (t.state === "queued" && t.deps.some((d) => gone.has(d))) {
        t.state = "cancelled";
        gone.add(other);
      }
    }
    return gone.size;
  }
}

module.exports = { TaskScheduler };
