"use strict";

function given(value) {
  if (value === "") throw new RangeError("empty");
}

// One of the tools a deploy drives (the builder, the registry, the migrator, the
// cluster, the chat bot). Each can run a release and undo it, and can be set to fail its
// next run.
class Subsystem {
  broken = false;

  constructor(name) {
    this.name = name;
  }

  run(release) {
    return `${this.name} ${release}`;
  }

  undo(release) {
    return `undo ${this.name} ${release}`;
  }
}

// One call in front of five subsystems: it runs them in order, unwinds the ones that ran
// when one fails, and keeps each service's live versions.
class DeployFacade {
  #steps = ["build", "push", "migrate", "rollout", "announce"].map(
    (name) => new Subsystem(name),
  );
  #live = new Map();

  deploy(service, version) {
    return this.#run(service, version, true);
  }

  breakStep(step) {
    const subsystem = this.#steps.find((s) => s.name === step);
    if (subsystem === undefined) throw new RangeError("unknown step");
    subsystem.broken = true;
  }

  history(service) {
    given(service);
    return [...(this.#live.get(service) ?? [])];
  }

  rollback(service) {
    given(service);
    const versions = this.#live.get(service) ?? [];
    if (versions.length < 2) return null;
    versions.pop();
    return versions.at(-1);
  }

  // The extension round: what a deploy would do right now, with nothing changed.
  dryRun(service, version) {
    return this.#run(service, version, false);
  }

  #run(service, version, real) {
    given(service);
    given(version);
    const release = `${service}@${version}`;
    const lines = [];
    const ran = [];
    for (const step of this.#steps) {
      if (step.broken) {
        if (real) step.broken = false;
        lines.push(`${step.run(release)} failed`);
        return [...lines, ...ran.reverse().map((done) => done.undo(release))];
      }
      lines.push(step.run(release));
      ran.push(step);
    }
    if (real) {
      const versions = this.#live.get(service) ?? [];
      versions.push(version);
      this.#live.set(service, versions);
    }
    return lines;
  }
}

module.exports = { DeployFacade };
