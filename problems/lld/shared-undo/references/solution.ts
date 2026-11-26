function checkName(text: string): void {
  if (text === "") throw new RangeError("an empty name or value");
}

function checkUser(user: string): void {
  checkName(user);
  if (user.includes(":")) throw new RangeError("a user name has no colon");
}

// A command that remembers the key's value before it ran (its memento), so it can be
// undone and redone. `at` counts its key's writes up to the one that last applied it: the
// edit, an undo or a redo.
class Edit {
  readonly user: string;
  readonly key: string;
  readonly before: string | null;
  readonly after: string;
  at = 0;

  constructor(user: string, key: string, before: string | null, after: string) {
    this.user = user;
    this.key = key;
    this.before = before;
    this.after = after;
  }
}

interface Write {
  user: string;
  entry: string;
}

export class SharedDoc {
  private readonly values = new Map<string, string>();
  private readonly writes = new Map<string, Write[]>();
  private readonly undos = new Map<string, Edit[]>();
  private readonly redos = new Map<string, Edit[]>();

  edit(user: string, key: string, val: string): void {
    checkUser(user);
    checkName(key);
    checkName(val);
    const command = new Edit(user, key, this.values.get(key) ?? null, val);
    this.write(command, "edit", val);
    this.stack(this.undos, user).push(command);
    this.redos.set(user, []);
  }

  undo(user: string): boolean {
    return this.undoLast(user, false);
  }

  redo(user: string): boolean {
    checkUser(user);
    const stack = this.stack(this.redos, user);
    const command = stack.at(-1);
    if (command === undefined || this.conflicts(command)) return false;
    stack.pop();
    this.write(command, "redo", command.after);
    this.stack(this.undos, user).push(command);
    return true;
  }

  value(key: string): string | null {
    checkName(key);
    return this.values.get(key) ?? null;
  }

  history(key: string): string[] {
    checkName(key);
    return (this.writes.get(key) ?? []).map((w) => w.entry);
  }

  // The extension round: an undo that goes through despite a conflict.
  undoForce(user: string): boolean {
    return this.undoLast(user, true);
  }

  private undoLast(user: string, force: boolean): boolean {
    checkUser(user);
    const stack = this.stack(this.undos, user);
    const command = stack.at(-1);
    if (command === undefined) return false;
    let action = "undo";
    if (this.conflicts(command)) {
      if (!force) return false;
      action = "force";
    }
    stack.pop();
    this.write(command, action, command.before);
    this.stack(this.redos, user).push(command);
    return true;
  }

  // Someone else wrote the key after the command last took effect.
  private conflicts(command: Edit): boolean {
    const later = (this.writes.get(command.key) ?? []).slice(command.at);
    return later.some((w) => w.user !== command.user);
  }

  private write(command: Edit, action: string, val: string | null): void {
    if (val === null) this.values.delete(command.key);
    else this.values.set(command.key, val);
    let writes = this.writes.get(command.key);
    if (writes === undefined) {
      writes = [];
      this.writes.set(command.key, writes);
    }
    writes.push({
      user: command.user,
      entry: `${action}:${command.user}:${val ?? ""}`,
    });
    command.at = writes.length;
  }

  private stack(stacks: Map<string, Edit[]>, user: string): Edit[] {
    let found = stacks.get(user);
    if (found === undefined) {
      found = [];
      stacks.set(user, found);
    }
    return found;
  }
}
