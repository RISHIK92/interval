"use strict";

const FIELDS = 3;
const MAX_AGE = 150;
const MAX_SECONDS = 1e9;
const MS_PER_SECOND = 1000;
const EVENT_TYPES = new Set(["click", "view", "buy"]);

// A whole number written without leading zeros, at most `most`; null otherwise.
function whole(text, most) {
  if (!/^(0|[1-9][0-9]{0,9})$/.test(text) || Number(text) > most) return null;
  return Number(text);
}

// The template method: `run` fixes the skeleton (extract, validate, transform, optionally
// dedupe, load) and each kind fills in only the steps that differ.
class Importer {
  loaded = [];
  rejects = [];
  #keys = new Set();
  #runs = 0;

  run(lines, dedupe) {
    if (lines.includes("")) throw new RangeError("an empty line");
    this.#runs++;
    const counts = { read: lines.length, loaded: 0, rejected: 0 };
    if (dedupe) counts.duplicates = 0;
    lines.forEach((line, i) => {
      const fields = line.split(",");
      const reason =
        fields.length !== FIELDS ? "fields" : this.validate(fields);
      if (reason !== null) {
        this.rejects.push(`${this.#runs}:${i + 1} ${reason}`);
        counts.rejected++;
        return;
      }
      const key = this.key(fields);
      if (dedupe && this.#keys.has(key)) {
        counts.duplicates++;
        return;
      }
      this.#keys.add(key);
      this.loaded.push(this.transform(fields));
      counts.loaded++;
    });
    return counts;
  }
}

// email,name,age
class UserImporter extends Importer {
  validate([email, name, age]) {
    const at = email.indexOf("@");
    if (at < 1 || at === email.length - 1 || email.indexOf("@", at + 1) >= 0)
      return "email";
    if (name === "") return "name";
    if (whole(age, MAX_AGE) === null) return "age";
    return null;
  }

  transform([email, name, age]) {
    return `user:${email.toLowerCase()}:${name}:${age}`;
  }

  key([email]) {
    return email.toLowerCase();
  }
}

// ts,type,user, with ts in seconds
class EventImporter extends Importer {
  validate([ts, kind, user]) {
    if (whole(ts, MAX_SECONDS) === null) return "ts";
    if (!EVENT_TYPES.has(kind)) return "type";
    if (user === "") return "user";
    return null;
  }

  transform([ts, kind, user]) {
    return `event:${Number(ts) * MS_PER_SECOND}:${kind}:${user}`;
  }

  key(fields) {
    return this.transform(fields);
  }
}

const KINDS = new Map([
  ["users", () => new UserImporter()],
  ["events", () => new EventImporter()],
]);

class ImportJob {
  #importer;
  #deduping = false;

  constructor(kind) {
    const make = KINDS.get(kind);
    if (make === undefined) throw new RangeError("unknown kind");
    this.#importer = make();
  }

  runImport(lines) {
    return this.#importer.run(lines, this.#deduping);
  }

  loaded() {
    return [...this.#importer.loaded];
  }

  rejects() {
    return [...this.#importer.rejects];
  }

  // The extension round: the skeleton's optional step, switched on or off.
  dedupe(on) {
    this.#deduping = on;
  }
}

module.exports = { ImportJob };
