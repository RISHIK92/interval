const MAX_REPLICAS = 1000;

interface Service {
  replicas: number;
  paused: boolean;
}

// A command object: it knows how to run itself and how to take itself back. Running
// reports whether anything changed: a command that changed nothing has nothing to undo.
interface Command {
  readonly service: string;
  run(service: Service): boolean;
  undo(service: Service): void;
}

class Scale implements Command {
  readonly service: string;
  private readonly target: number;
  private before = 0;

  constructor(service: string, target: number) {
    this.service = service;
    this.target = target;
  }

  run(service: Service): boolean {
    this.before = service.replicas;
    service.replicas = this.target;
    return this.before !== this.target;
  }

  undo(service: Service): void {
    service.replicas = this.before;
  }
}

class Pause implements Command {
  readonly service: string;

  constructor(service: string) {
    this.service = service;
  }

  run(service: Service): boolean {
    const changed = !service.paused;
    service.paused = true;
    return changed;
  }

  undo(service: Service): void {
    service.paused = false;
  }
}

class Resume implements Command {
  readonly service: string;

  constructor(service: string) {
    this.service = service;
  }

  run(service: Service): boolean {
    const changed = service.paused;
    service.paused = false;
    return changed;
  }

  undo(service: Service): void {
    service.paused = true;
  }
}

function parse(command: string, arg: string): Command {
  if (command === "scale") {
    const at = arg.indexOf("=");
    const name = at < 0 ? "" : arg.slice(0, at);
    const count = at < 0 ? "" : arg.slice(at + 1);
    if (
      name === "" ||
      !/^(0|[1-9][0-9]{0,3})$/.test(count) ||
      Number(count) > MAX_REPLICAS
    )
      throw new RangeError("scale takes <service>=<0 to 1000>");
    return new Scale(name, Number(count));
  }
  if (arg === "" || arg.includes("=")) throw new RangeError("a service name");
  if (command === "pause") return new Pause(arg);
  if (command === "resume") return new Resume(arg);
  throw new RangeError("unknown command");
}

interface Entry {
  readonly id: string;
  readonly line: string;
  readonly command: Command;
}

export class CommandBus {
  private readonly services = new Map<string, Service>();
  private readonly ids = new Set<string>();
  private queue: Entry[] = [];
  private scheduled: (Entry & { readonly atMs: number })[] = [];
  private readonly done: (Entry & { readonly target: Service })[] = [];
  private readonly history: string[] = [];

  private accept(id: string, command: string, arg: string): Entry | null {
    if (id === "") throw new RangeError("an empty id");
    const parsed = parse(command, arg);
    if (this.ids.has(id)) return null;
    this.ids.add(id);
    return { id, line: `${command} ${arg}`, command: parsed };
  }

  private run(entry: Entry): string {
    let service = this.services.get(entry.command.service);
    if (service === undefined) {
      service = { replicas: 0, paused: false };
      this.services.set(entry.command.service, service);
    }
    let line = `${entry.id}: skipped`;
    if (entry.command.run(service)) {
      this.done.push({ ...entry, target: service });
      line = `${entry.id}: ${entry.line}`;
    }
    this.history.push(line);
    return line;
  }

  submit(id: string, command: string, arg: string): boolean {
    const entry = this.accept(id, command, arg);
    if (entry === null) return false;
    this.queue.push(entry);
    return true;
  }

  execute(): string[] {
    const queue = this.queue;
    this.queue = [];
    return queue.map((entry) => this.run(entry));
  }

  undoLast(): string | null {
    const entry = this.done.pop();
    if (entry === undefined) return null;
    entry.command.undo(entry.target);
    this.history.push(`${entry.id}: undone`);
    return entry.id;
  }

  replicas(service: string): number {
    if (service === "") throw new RangeError("an empty service");
    const found = this.services.get(service);
    return found === undefined || found.paused ? 0 : found.replicas;
  }

  log(): string[] {
    return [...this.history];
  }

  // The extension round: commands that wait for their time, sharing the ids and the
  // undo stack.
  schedule(id: string, command: string, arg: string, atMs: number): boolean {
    if (atMs < 0) throw new RangeError("a negative time");
    const entry = this.accept(id, command, arg);
    if (entry === null) return false;
    this.scheduled.push({ ...entry, atMs });
    return true;
  }

  executeDue(nowMs: number): string[] {
    if (nowMs < 0) throw new RangeError("a negative time");
    // A stable sort: commands due at the same time run in the order they were scheduled.
    const due = this.scheduled
      .filter((entry) => entry.atMs <= nowMs)
      .sort((a, b) => a.atMs - b.atMs);
    this.scheduled = this.scheduled.filter((entry) => entry.atMs > nowMs);
    return due.map((entry) => this.run(entry));
  }
}
