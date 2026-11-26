"use strict";

const STEPS = ["checkout", "setup", "install", "test", "report"];
const HOOKS = new Set(["setup", "install"]);

// The template: run() fixes the skeleton and its rules (skipped hooks, stopping at a
// failure, report always running), and each kind fills in only its own commands.
// setup and install are hooks: a kind that doesn't override one has no such step.
class Job {
  checkout() {
    return "git checkout";
  }

  setup() {
    return null;
  }

  install() {
    return null;
  }

  report() {
    return "publish results";
  }

  run(skipped, failAt, before) {
    const commands = [
      this.checkout(),
      this.setup(),
      this.install(),
      this.test(),
      this.report(),
    ];
    const log = [];
    let failed = false;
    STEPS.forEach((step, i) => {
      let command = commands[i];
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
  setup() {
    return "nvm use";
  }

  install() {
    return "npm ci";
  }

  test() {
    return "npm test";
  }
}

class PythonJob extends Job {
  setup() {
    return "python -m venv .venv";
  }

  install() {
    return "pip install -r requirements.txt";
  }

  test() {
    return "pytest";
  }
}

class GoJob extends Job {
  install() {
    return "go mod download";
  }

  test() {
    return "go test ./...";
  }
}

const KINDS = new Map([
  ["node", NodeJob],
  ["python", PythonJob],
  ["go", GoJob],
]);

function job(kind) {
  const Kind = KINDS.get(kind);
  if (Kind === undefined) throw new RangeError("unknown kind");
  return new Kind();
}

// Runs CI jobs of every kind through the one template, with the steps skipped and the
// commands to run before each step shared by all kinds.
class JobRunner {
  #skipped = new Set();
  #before = [];

  steps(kind) {
    return job(kind).run(this.#skipped, "", this.#before);
  }

  skip(step) {
    if (!HOOKS.has(step)) throw new RangeError("only a hook can be skipped");
    this.#skipped.add(step);
  }

  runJob(kind, failAt) {
    const found = job(kind);
    if (failAt !== "" && !STEPS.includes(failAt))
      throw new RangeError("unknown step");
    return found.run(this.#skipped, failAt, this.#before);
  }

  // The extension round: a command before every step.
  beforeEach(command) {
    if (command === "") throw new RangeError("empty command");
    this.#before.push(command);
  }
}

module.exports = { JobRunner };
