type Config = Map<string, string>;

interface Command {
  do(config: Config): void;
  undo(config: Config): void;
}

// A command: one edit to one key. Doing it remembers the key's value before, so undoing
// it is the same for every kind of edit.
abstract class Edit implements Command {
  readonly key: string;
  readonly val: string;
  private before: string | undefined = undefined;

  constructor(key: string, val: string) {
    this.key = key;
    this.val = val;
  }

  abstract refused(config: Config): boolean;
  protected abstract change(config: Config): void;

  do(config: Config): void {
    this.before = config.get(this.key);
    this.change(config);
  }

  undo(config: Config): void {
    if (this.before === undefined) config.delete(this.key);
    else config.set(this.key, this.before);
  }
}

class Put extends Edit {
  refused(config: Config): boolean {
    return config.get(this.key) === this.val;
  }

  protected change(config: Config): void {
    config.set(this.key, this.val);
  }
}

class Remove extends Edit {
  refused(config: Config): boolean {
    return !config.has(this.key);
  }

  protected change(config: Config): void {
    config.delete(this.key);
  }
}

class Append extends Edit {
  refused(config: Config): boolean {
    return !config.has(this.key) || this.val === "";
  }

  protected change(config: Config): void {
    config.set(this.key, (config.get(this.key) ?? "") + this.val);
  }
}

// Several edits done and undone as one command: undone in reverse order.
class Batch implements Command {
  private readonly edits: readonly Edit[];

  constructor(edits: readonly Edit[]) {
    this.edits = edits;
  }

  do(config: Config): void {
    for (const edit of this.edits) edit.do(config);
  }

  undo(config: Config): void {
    for (const edit of [...this.edits].reverse()) edit.undo(config);
  }
}

const OPS = new Map<string, new (key: string, val: string) => Edit>([
  ["put", Put],
  ["remove", Remove],
  ["append", Append],
]);

function makeEdit(op: string, key: string, val: string): Edit {
  const Kind = OPS.get(op);
  if (Kind === undefined || key === "")
    throw new RangeError("unknown op or empty key");
  return new Kind(key, val);
}

function parse(entry: string): Edit {
  const first = entry.indexOf(" ");
  const second = first < 0 ? -1 : entry.indexOf(" ", first + 1);
  if (second < 0) throw new RangeError("not <op> <key> <val>");
  return makeEdit(
    entry.slice(0, first),
    entry.slice(first + 1, second),
    entry.slice(second + 1),
  );
}

// Every change is a command kept on a history, so undo and redo never need to know
// which kind of edit they're reversing.
export class ConfigEditor {
  private readonly config: Config = new Map();
  private readonly done: Command[] = [];
  private undone: Command[] = [];

  apply(op: string, key: string, val: string): boolean {
    const edit = makeEdit(op, key, val);
    if (edit.refused(this.config)) return false;
    edit.do(this.config);
    this.record(edit);
    return true;
  }

  undo(): boolean {
    const command = this.done.pop();
    if (command === undefined) return false;
    command.undo(this.config);
    this.undone.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.undone.pop();
    if (command === undefined) return false;
    command.do(this.config);
    this.done.push(command);
    return true;
  }

  view(): Record<string, string> {
    return Object.fromEntries(this.config);
  }

  // The extension round: several edits as one command.
  batch(ops: string[]): boolean {
    const edits = ops.map(parse);
    const applied: Edit[] = [];
    for (const edit of edits) {
      if (edit.refused(this.config)) continue;
      edit.do(this.config);
      applied.push(edit);
    }
    if (applied.length === 0) return false;
    this.record(new Batch(applied));
    return true;
  }

  private record(command: Command): void {
    this.done.push(command);
    this.undone = [];
  }
}
