"use strict";

class Leaderboard {
  constructor() {
    this.totals = new Map();
  }

  ordered() {
    // By code unit, not locale: the statement orders names by character code.
    return [...this.totals.keys()].sort(
      (a, b) =>
        this.totals.get(b) - this.totals.get(a) || (a < b ? -1 : a > b ? 1 : 0),
    );
  }

  add(player, points) {
    if (points <= 0) throw new RangeError("points must be positive");
    const total = (this.totals.get(player) ?? 0) + points;
    this.totals.set(player, total);
    return total;
  }

  top(k) {
    if (k < 0) throw new RangeError("negative k");
    return this.ordered().slice(0, k);
  }

  rank(player) {
    if (!this.totals.has(player)) return null;
    return this.ordered().indexOf(player) + 1;
  }

  // The extension round.
  around(player, radius) {
    if (radius < 0) throw new RangeError("negative radius");
    if (!this.totals.has(player)) return [];
    const ordered = this.ordered();
    const at = ordered.indexOf(player);
    return ordered.slice(Math.max(0, at - radius), at + radius + 1);
  }

  remove(player) {
    return this.totals.delete(player);
  }
}

module.exports = { Leaderboard };
