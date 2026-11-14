type State = "queued" | "running" | "done" | "cancelled";
interface Task {
  priority: number;
  deps: string[];
  state: State;
}

export class TaskScheduler {
  // Insertion order is the order of adding, which breaks priority ties.
  private readonly tasks = new Map<string, Task>();

  private isReady(task: Task): boolean {
    return (
      task.state === "queued" &&
      task.deps.every((d) => this.tasks.get(d)?.state === "done")
    );
  }

  add(id: string, priority: number, deps: string[]): void {
    if (this.tasks.has(id)) throw new Error("duplicate id");
    if (deps.some((d) => !this.tasks.has(d)))
      throw new Error("unknown dependency");
    this.tasks.set(id, { priority, deps: [...deps], state: "queued" });
  }

  next(): string | null {
    let best: string | null = null;
    let bestPriority = 0;
    for (const [id, task] of this.tasks) {
      // Strictly greater, so the earliest added keeps a tie.
      if (
        this.isReady(task) &&
        (best === null || task.priority > bestPriority)
      ) {
        best = id;
        bestPriority = task.priority;
      }
    }
    if (best !== null) {
      const chosen = this.tasks.get(best);
      if (chosen !== undefined) chosen.state = "running";
    }
    return best;
  }

  complete(id: string): void {
    const task = this.tasks.get(id);
    if (task === undefined || task.state !== "running")
      throw new Error("not running");
    task.state = "done";
  }

  status(id: string): string {
    const task = this.tasks.get(id);
    if (task === undefined) throw new Error("unknown id");
    if (task.state === "queued")
      return this.isReady(task) ? "ready" : "waiting";
    return task.state;
  }

  // The extension round.
  cancel(id: string): number {
    const task = this.tasks.get(id);
    if (task === undefined) throw new Error("unknown id");
    if (task.state === "done") throw new Error("already done");
    if (task.state === "cancelled") return 0;
    // Dependencies are always added first, so one pass in order finds every dependent.
    const gone = new Set<string>([id]);
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
