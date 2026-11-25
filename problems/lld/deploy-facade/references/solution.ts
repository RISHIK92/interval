function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

// One of the tools a deploy drives (the builder, the registry, the migrator, the
// cluster, the chat bot). Each can run a release and undo it, and can be set to fail its
// next run.
class Subsystem {
  readonly name: string;
  broken = false;

  constructor(name: string) {
    this.name = name;
  }

  run(release: string): string {
    return `${this.name} ${release}`;
  }

  undo(release: string): string {
    return `undo ${this.name} ${release}`;
  }
}

// One call in front of five subsystems: it runs them in order, unwinds the ones that ran
// when one fails, and keeps each service's live versions.
export class DeployFacade {
  private readonly steps = [
    "build",
    "push",
    "migrate",
    "rollout",
    "announce",
  ].map((name) => new Subsystem(name));
  private readonly live = new Map<string, string[]>();

  deploy(service: string, version: string): string[] {
    return this.run(service, version, true);
  }

  breakStep(step: string): void {
    const subsystem = this.steps.find((s) => s.name === step);
    if (subsystem === undefined) throw new RangeError("unknown step");
    subsystem.broken = true;
  }

  history(service: string): string[] {
    given(service);
    return [...(this.live.get(service) ?? [])];
  }

  rollback(service: string): string | null {
    given(service);
    const versions = this.live.get(service) ?? [];
    if (versions.length < 2) return null;
    versions.pop();
    return versions.at(-1) ?? null;
  }

  // The extension round: what a deploy would do right now, with nothing changed.
  dryRun(service: string, version: string): string[] {
    return this.run(service, version, false);
  }

  private run(service: string, version: string, real: boolean): string[] {
    given(service);
    given(version);
    const release = `${service}@${version}`;
    const lines: string[] = [];
    const ran: Subsystem[] = [];
    for (const step of this.steps) {
      if (step.broken) {
        if (real) step.broken = false;
        lines.push(`${step.run(release)} failed`);
        return [...lines, ...ran.reverse().map((done) => done.undo(release))];
      }
      lines.push(step.run(release));
      ran.push(step);
    }
    if (real) {
      const versions = this.live.get(service) ?? [];
      versions.push(version);
      this.live.set(service, versions);
    }
    return lines;
  }
}
