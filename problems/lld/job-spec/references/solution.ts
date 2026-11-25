const KEY = /^[A-Z][A-Z0-9_]*$/;

function checkedKey(key: string): string {
  if (!KEY.test(key)) throw new RangeError("an env key is upper snake case");
  return key;
}

type EnvValue = { value: string; secret: boolean };

export class JobSpec {
  private readonly name: string;
  private readonly steps: string[] = [];
  private readonly env = new Map<string, EnvValue>();

  constructor(name: string) {
    if (name === "") throw new RangeError("a job needs a name");
    this.name = name;
  }

  addStep(command: string): number {
    if (command === "") throw new RangeError("a step needs a command");
    this.steps.push(command);
    return this.steps.length;
  }

  setEnv(key: string, value: string): void {
    this.env.set(checkedKey(key), { value, secret: false });
  }

  render(): string[] {
    const vars = [...this.env.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return [
      `job ${this.name}`,
      ...vars.map(([key, v]) => `env ${key}=${v.secret ? "***" : v.value}`),
      ...this.steps.map((command, i) => `step ${String(i + 1)}: ${command}`),
    ];
  }

  stepCount(): number {
    return this.steps.length;
  }

  // The extension round.
  secret(key: string, value: string): void {
    this.env.set(checkedKey(key), { value, secret: true });
  }
}
