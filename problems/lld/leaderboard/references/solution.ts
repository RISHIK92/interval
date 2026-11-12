export class Leaderboard {
  private readonly totals = new Map<string, number>();

  private ordered(): string[] {
    const total = (p: string) => this.totals.get(p) ?? 0;
    // By code unit, not locale: the statement orders names by character code.
    return [...this.totals.keys()].sort(
      (a, b) => total(b) - total(a) || (a < b ? -1 : a > b ? 1 : 0),
    );
  }

  add(player: string, points: number): number {
    if (points <= 0) throw new RangeError("points must be positive");
    const total = (this.totals.get(player) ?? 0) + points;
    this.totals.set(player, total);
    return total;
  }

  top(k: number): string[] {
    if (k < 0) throw new RangeError("negative k");
    return this.ordered().slice(0, k);
  }

  rank(player: string): number | null {
    if (!this.totals.has(player)) return null;
    return this.ordered().indexOf(player) + 1;
  }

  // The extension round.
  around(player: string, radius: number): string[] {
    if (radius < 0) throw new RangeError("negative radius");
    if (!this.totals.has(player)) return [];
    const ordered = this.ordered();
    const at = ordered.indexOf(player);
    return ordered.slice(Math.max(0, at - radius), at + radius + 1);
  }

  remove(player: string): boolean {
    return this.totals.delete(player);
  }
}
