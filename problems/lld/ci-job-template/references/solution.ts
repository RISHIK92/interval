const STEPS = ["checkout", "setup", "install", "test", "report"] as const;
const HOOKS: ReadonlySet<string> = new Set(["setup", "install"]);

// The template: run() fixes the skeleton and its rules (skipped hooks, stopping at a
// failure, report always running), and each kind fills in only its own commands.
// setup and install are hooks: a kind that doesn't override one has no such step.
abstract class Job {
  protected checkout(): string {
    return "git checkout";
  }

  protected setup(): string | null {
    return null;
  }

  protected install(): string | null {
    return null;
  }

  protected abstract test(): string;

  protected report(): string {
    return "publish results";
  }

  run(
    skipped: ReadonlySet<string>,
    failAt: string,
    before: readonly string[],
  ): string[] {
    const commands = [
      this.checkout(),
      this.setup(),
      this.install(),
      this.test(),
      this.report(),
    ];
    const log: string[] = [];
    let failed = false;
    STEPS.forEach((step, i) => {
      let command = commands[i] ?? null;
      if (
        command === null ||
        skipped.has(step) ||
        (failed && step !== "report")
      )
        return;
      for (const hook of before) log.push(`before ${step}: ${hook}`);
      if (step === failAt) {
        failed = true;
        command += " [failed]";
      }
      log.push(`${step}: ${command}`);
    });
    return log;
  }
}

class NodeJob extends Job {
  protected override setup(): string {
    return "nvm use";
  }

  protected override install(): string {
    return "npm ci";
  }

  protected override test(): string {
    return "npm test";
  }
}

class PythonJob extends Job {
  protected override setup(): string {
    return "python -m venv .venv";
  }

  protected override install(): string {
    return "pip install -r requirements.txt";
  }

  protected override test(): string {
    return "pytest";
  }
}

class GoJob extends Job {
  protected override install(): string {
    return "go mod download";
  }

  protected override test(): string {
    return "go test ./...";
  }
}

const KINDS = new Map<string, new () => Job>([
  ["node", NodeJob],
  ["python", PythonJob],
  ["go", GoJob],
]);

function job(kind: string): Job {
  const Kind = KINDS.get(kind);
  if (Kind === undefined) throw new RangeError("unknown kind");
  return new Kind();
}

// Runs CI jobs of every kind through the one template, with the steps skipped and the
// commands to run before each step shared by all kinds.
export class JobRunner {
  private readonly skipped = new Set<string>();
  private readonly before: string[] = [];

  steps(kind: string): string[] {
    return job(kind).run(this.skipped, "", this.before);
  }

  skip(step: string): void {
    if (!HOOKS.has(step)) throw new RangeError("only a hook can be skipped");
    this.skipped.add(step);
  }

  runJob(kind: string, failAt: string): string[] {
    const found = job(kind);
    if (failAt !== "" && !(STEPS as readonly string[]).includes(failAt))
      throw new RangeError("unknown step");
    return found.run(this.skipped, failAt, this.before);
  }

  // The extension round: a command before every step.
  beforeEach(command: string): void {
    if (command === "") throw new RangeError("empty command");
    this.before.push(command);
  }
}
