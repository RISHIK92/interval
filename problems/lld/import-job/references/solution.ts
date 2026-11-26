const FIELDS = 3;
const MAX_AGE = 150;
const MAX_SECONDS = 1e9;
const MS_PER_SECOND = 1000;
const EVENT_TYPES = new Set(["click", "view", "buy"]);

// A whole number written without leading zeros, at most `most`; null otherwise.
function whole(text: string, most: number): number | null {
  if (!/^(0|[1-9][0-9]{0,9})$/.test(text) || Number(text) > most) return null;
  return Number(text);
}

type Fields = [string, string, string];

// The template method: `run` fixes the skeleton (extract, validate, transform, optionally
// dedupe, load) and each kind fills in only the steps that differ.
abstract class Importer {
  readonly loaded: string[] = [];
  readonly rejects: string[] = [];
  private readonly keys = new Set<string>();
  private runs = 0;

  protected abstract validate(fields: Fields): string | null;
  protected abstract transform(fields: Fields): string;
  protected abstract key(fields: Fields): string;

  run(lines: string[], dedupe: boolean): Record<string, number> {
    if (lines.includes("")) throw new RangeError("an empty line");
    this.runs++;
    let loaded = 0;
    let rejected = 0;
    let duplicates = 0;
    lines.forEach((line, i) => {
      const fields = line.split(",");
      const reason =
        fields.length !== FIELDS ? "fields" : this.validate(fields as Fields);
      if (reason !== null) {
        this.rejects.push(`${String(this.runs)}:${String(i + 1)} ${reason}`);
        rejected++;
        return;
      }
      const key = this.key(fields as Fields);
      if (dedupe && this.keys.has(key)) {
        duplicates++;
        return;
      }
      this.keys.add(key);
      this.loaded.push(this.transform(fields as Fields));
      loaded++;
    });
    const counts: Record<string, number> = {
      read: lines.length,
      loaded,
      rejected,
    };
    if (dedupe) counts["duplicates"] = duplicates;
    return counts;
  }
}

// email,name,age
class UserImporter extends Importer {
  protected validate([email, name, age]: Fields): string | null {
    const at = email.indexOf("@");
    if (at < 1 || at === email.length - 1 || email.indexOf("@", at + 1) >= 0)
      return "email";
    if (name === "") return "name";
    if (whole(age, MAX_AGE) === null) return "age";
    return null;
  }

  protected transform([email, name, age]: Fields): string {
    return `user:${email.toLowerCase()}:${name}:${age}`;
  }

  protected key([email]: Fields): string {
    return email.toLowerCase();
  }
}

// ts,type,user, with ts in seconds
class EventImporter extends Importer {
  protected validate([ts, kind, user]: Fields): string | null {
    if (whole(ts, MAX_SECONDS) === null) return "ts";
    if (!EVENT_TYPES.has(kind)) return "type";
    if (user === "") return "user";
    return null;
  }

  protected transform([ts, kind, user]: Fields): string {
    return `event:${String(Number(ts) * MS_PER_SECOND)}:${kind}:${user}`;
  }

  protected key(fields: Fields): string {
    return this.transform(fields);
  }
}

const KINDS = new Map<string, () => Importer>([
  ["users", () => new UserImporter()],
  ["events", () => new EventImporter()],
]);

export class ImportJob {
  private readonly importer: Importer;
  private deduping = false;

  constructor(kind: string) {
    const make = KINDS.get(kind);
    if (make === undefined) throw new RangeError("unknown kind");
    this.importer = make();
  }

  runImport(lines: string[]): Record<string, number> {
    return this.importer.run(lines, this.deduping);
  }

  loaded(): string[] {
    return [...this.importer.loaded];
  }

  rejects(): string[] {
    return [...this.importer.rejects];
  }

  // The extension round: the skeleton's optional step, switched on or off.
  dedupe(on: boolean): void {
    this.deduping = on;
  }
}
