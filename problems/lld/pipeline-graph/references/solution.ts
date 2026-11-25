function named(...names: string[]): void {
  if (names.includes(""))
    throw new RangeError("stage and job names are not empty");
}

// The pipeline owns stages, a stage owns its jobs (composition); a job only names the
// jobs it needs (dependency), all in earlier stages, so a run goes in stage order.
export class Pipeline {
  private readonly stages: string[] = [];
  private readonly jobs = new Map<string, string[]>();
  private readonly stageOf = new Map<string, string>();
  private readonly needs = new Map<string, string[]>();
  private readonly failing = new Set<string>();
  private readonly allowed = new Set<string>();

  private known(job: string): void {
    named(job);
    if (!this.stageOf.has(job)) throw new RangeError("unknown job");
  }

  stage(name: string): void {
    named(name);
    if (this.jobs.has(name)) throw new RangeError("stage already exists");
    this.stages.push(name);
    this.jobs.set(name, []);
  }

  job(stage: string, name: string, needs: string[]): boolean {
    named(stage, name, ...needs);
    const owned = this.jobs.get(stage);
    if (owned === undefined) throw new RangeError("unknown stage");
    if (new Set(needs).size !== needs.length)
      throw new RangeError("a need is listed twice");
    if (this.stageOf.has(name)) return false;
    const earlier = this.stages.slice(0, this.stages.indexOf(stage));
    if (needs.some((n) => !earlier.includes(this.stageOf.get(n) ?? "")))
      return false;
    owned.push(name);
    this.stageOf.set(name, stage);
    this.needs.set(name, [...needs]);
    return true;
  }

  fail(job: string): void {
    this.known(job);
    this.failing.add(job);
  }

  private blocks(need: string, result: string | undefined): boolean {
    return (
      result === "skipped" || (result === "failed" && !this.allowed.has(need))
    );
  }

  run(): string[] {
    const outcome = new Map<string, string>();
    for (const stage of this.stages)
      for (const job of this.jobs.get(stage) ?? []) {
        let result = this.failing.has(job) ? "failed" : "passed";
        const needs = this.needs.get(job) ?? [];
        if (needs.some((n) => this.blocks(n, outcome.get(n))))
          result = "skipped";
        outcome.set(job, result);
      }
    return [...outcome].map(([job, result]) => `${job}: ${result}`);
  }

  removeStage(name: string): number {
    named(name);
    const owned = this.jobs.get(name);
    if (owned === undefined) throw new RangeError("unknown stage");
    for (const [job, needs] of this.needs)
      if (!owned.includes(job) && needs.some((n) => owned.includes(n)))
        throw new RangeError("a later job needs this stage");
    for (const job of owned) {
      this.stageOf.delete(job);
      this.needs.delete(job);
      this.failing.delete(job);
      this.allowed.delete(job);
    }
    this.stages.splice(this.stages.indexOf(name), 1);
    this.jobs.delete(name);
    return owned.length;
  }

  // The extension round: an allowed failure doesn't skip the jobs that need it.
  allowFailure(job: string): void {
    this.known(job);
    this.allowed.add(job);
  }
}
