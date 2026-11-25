const CAPABILITIES = new Set(["build", "test", "deploy", "gpu"]);

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function given(value: string): void {
  if (value === "") throw new RangeError("empty name");
}

function known(capabilities: string[]): Set<string> {
  if (!capabilities.every((c) => CAPABILITIES.has(c)))
    throw new RangeError("unknown capability");
  return new Set(capabilities);
}

// There is deliberately no Runner interface with build, test, deploy and gpu methods, which
// would force a build-only runner to stub a deploy. A runner holds only the capabilities it
// really has, and a job is matched against just the ones it needs.
class Runner {
  readonly capabilities: Set<string>;
  job: string | null = null;
  draining = false;

  constructor(capabilities: Set<string>) {
    this.capabilities = capabilities;
  }

  takes(needs: Set<string>): boolean {
    return (
      this.job === null &&
      !this.draining &&
      [...needs].every((n) => this.capabilities.has(n))
    );
  }
}

export class RunnerPool {
  private readonly runners = new Map<string, Runner>();
  private readonly jobs = new Map<string, string>();

  addRunner(name: string, capabilities: string[]): void {
    given(name);
    if (this.runners.has(name))
      throw new RangeError("runner already in the pool");
    this.runners.set(name, new Runner(known(capabilities)));
  }

  assign(job: string, needs: string[]): string | null {
    given(job);
    const wanted = known(needs);
    if (this.jobs.has(job)) throw new RangeError("job already running");
    for (const [name, runner] of this.runners) {
      if (runner.takes(wanted)) {
        runner.job = job;
        this.jobs.set(job, name);
        return name;
      }
    }
    return null;
  }

  finish(job: string): boolean {
    given(job);
    const name = this.jobs.get(job);
    if (name === undefined) return false;
    this.jobs.delete(job);
    const runner = this.runners.get(name);
    if (runner !== undefined) runner.job = null;
    this.leaveIfDrained(name);
    return true;
  }

  busy(): string[] {
    return [...this.jobs.values()].sort(byCode);
  }

  // The extension round: a runner on its way out.
  drain(name: string): void {
    given(name);
    const runner = this.runners.get(name);
    if (runner === undefined) throw new RangeError("no such runner");
    runner.draining = true;
    this.leaveIfDrained(name);
  }

  private leaveIfDrained(name: string): void {
    const runner = this.runners.get(name);
    if (runner !== undefined && runner.draining && runner.job === null)
      this.runners.delete(name);
  }
}
