const FAILED = "fail:";
const STEPS = ["create-user", "create-repo", "grant-access", "send-welcome"];
const MAX_TIMES = 1000;

// A command with its compensation. Each returns what it did, for the trail; an injected
// failure count makes the next attempts fail.
class Step {
  readonly name: string;
  failures = 0;

  constructor(name: string) {
    this.name = name;
  }

  execute(): string {
    if (this.failures === 0) return `do:${this.name}`;
    this.failures -= 1;
    return FAILED + this.name;
  }

  compensate(): string {
    return `undo:${this.name}`;
  }
}

// One account's run: the steps done, in order, and everything that happened.
class Saga {
  done: Step[] = [];
  readonly trail: string[] = [];
  status = "";

  resume(steps: readonly Step[], pivot: Step | undefined): void {
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

  private failed(pivot: Step | undefined): void {
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

export class ProvisioningSaga {
  private readonly steps = STEPS.map((name) => new Step(name));
  private readonly sagas = new Map<string, Saga>();
  private pivotStep: Step | undefined;

  failStep(step: string, times: number): void {
    const found = this.findStep(step);
    if (times < 0 || times > MAX_TIMES)
      throw new RangeError("times runs from 0 to 1000");
    found.failures = times;
  }

  start(account: string): string {
    if (account === "") throw new RangeError("an empty account");
    let saga = this.sagas.get(account);
    if (saga === undefined) {
      saga = new Saga();
      this.sagas.set(account, saga);
      saga.resume(this.steps, this.pivotStep);
    }
    return saga.status;
  }

  retry(account: string): string {
    const saga = this.findSaga(account);
    saga.resume(this.steps, this.pivotStep);
    return saga.status;
  }

  trail(account: string): string[] {
    return [...this.findSaga(account).trail];
  }

  status(account: string): string {
    return this.findSaga(account).status;
  }

  // The extension round: a pivot step, past which the saga only moves forward.
  pivot(step: string): void {
    this.pivotStep = this.findStep(step);
  }

  private findStep(name: string): Step {
    const step = this.steps.find((s) => s.name === name);
    if (step === undefined) throw new RangeError("no such step");
    return step;
  }

  private findSaga(account: string): Saga {
    const saga = this.sagas.get(account);
    if (saga === undefined) throw new RangeError("no such account");
    return saga;
  }
}
