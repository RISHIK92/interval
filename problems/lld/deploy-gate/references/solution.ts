function named(name: string): void {
  if (name === "") throw new RangeError("check names are not empty");
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Callers tell the gate what happened and ask it one question, "may I deploy?". Which
// checks are required, what they last reported and which are waived stay inside.
export class DeployGate {
  private readonly required = new Set<string>();
  private readonly passed = new Map<string, boolean>(); // each check's latest report
  private readonly waived = new Map<string, string>(); // check -> reason

  require(check: string): void {
    named(check);
    this.required.add(check);
  }

  report(check: string, passed: boolean): void {
    named(check);
    this.passed.set(check, passed);
  }

  private blocks(check: string): boolean {
    return !this.waived.has(check) && this.passed.get(check) !== true;
  }

  mayDeploy(): boolean {
    return ![...this.required].some((c) => this.blocks(c));
  }

  blockers(): string[] {
    return [...this.required].filter((c) => this.blocks(c)).sort(byCode);
  }

  // The extension round: a waived check never blocks.
  waive(check: string, reason: string): void {
    named(check);
    if (reason === "") throw new RangeError("a waiver has a reason");
    if (!this.required.has(check))
      throw new RangeError("only a required check is waived");
    this.waived.set(check, reason);
  }

  waivers(): string[] {
    return [...this.waived.keys()]
      .sort(byCode)
      .map((c) => `${c}: ${this.waived.get(c) ?? ""}`);
  }
}
