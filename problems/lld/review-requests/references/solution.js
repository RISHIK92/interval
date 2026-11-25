"use strict";

function named(...names) {
  if (names.includes("")) throw new RangeError("ids and names are not empty");
}

// Pull requests and people are associated, never owned: a pull request holds the names
// of its author and reviewers, and each reviewer's queue holds pull request ids.
class ReviewQueue {
  #prs = new Map();
  #pending = new Map();
  #owners = [];

  #get(pr) {
    const found = this.#prs.get(pr);
    if (found === undefined) throw new RangeError("unknown pull request");
    return found;
  }

  open(pr, author) {
    named(pr, author);
    if (this.#prs.has(pr)) throw new RangeError("pull request already opened");
    this.#prs.set(pr, { author, requested: new Set(), approved: new Set() });
  }

  request(pr, reviewer) {
    named(pr, reviewer);
    const found = this.#get(pr);
    if (reviewer === found.author || found.requested.has(reviewer))
      return false;
    found.requested.add(reviewer);
    const queue = this.#pending.get(reviewer) ?? [];
    queue.push(pr);
    this.#pending.set(reviewer, queue);
    return true;
  }

  approve(pr, reviewer) {
    named(pr, reviewer);
    const found = this.#get(pr);
    if (!found.requested.has(reviewer) || found.approved.has(reviewer))
      return false;
    found.approved.add(reviewer);
    const queue = this.#pending.get(reviewer);
    queue.splice(queue.indexOf(pr), 1);
    return true;
  }

  pendingFor(reviewer) {
    named(reviewer);
    return [...(this.#pending.get(reviewer) ?? [])];
  }

  approvals(pr) {
    named(pr);
    return this.#get(pr).approved.size;
  }

  // The extension round: owners of a path prefix are requested when it's touched.
  codeowner(pathPrefix, reviewer) {
    named(pathPrefix, reviewer);
    if (!this.#owners.some(([p, r]) => p === pathPrefix && r === reviewer))
      this.#owners.push([pathPrefix, reviewer]);
  }

  touch(pr, path) {
    named(pr, path);
    this.#get(pr);
    let added = 0;
    for (const [prefix, reviewer] of this.#owners)
      if (path.startsWith(prefix) && this.request(pr, reviewer)) added++;
    return added;
  }
}

module.exports = { ReviewQueue };
