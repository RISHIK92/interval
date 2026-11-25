const MAX_SIZE = 1000;

export class ConnPool {
  private readonly max: number;
  // Every connection ever made, including the discarded ones.
  private readonly made = new Set<string>();
  // Most recently released last: reusing from the end keeps the warmest connection busy
  // and lets the coldest ones age out.
  private idleConns: string[] = [];
  private readonly held = new Map<string, string>();

  constructor(maxSize: number) {
    if (maxSize < 1 || maxSize > MAX_SIZE)
      throw new RangeError("maxSize is 1 to 1000");
    this.max = maxSize;
  }

  private known(conn: string): void {
    if (!this.made.has(conn))
      throw new RangeError("not a connection this pool made");
  }

  acquire(client: string): string | null {
    if (client === "") throw new RangeError("clients are named");
    let conn = this.idleConns.pop();
    if (conn === undefined) {
      if (this.held.size >= this.max) return null;
      conn = `conn-${String(this.made.size + 1)}`;
      this.made.add(conn);
    }
    this.held.set(conn, client);
    return conn;
  }

  release(conn: string): boolean {
    this.known(conn);
    if (!this.held.delete(conn)) return false;
    this.idleConns.push(conn);
    return true;
  }

  invalidate(conn: string): boolean {
    this.known(conn);
    const at = this.idleConns.indexOf(conn);
    if (at >= 0) {
      this.idleConns.splice(at, 1);
      return true;
    }
    return this.held.delete(conn);
  }

  created(): number {
    return this.made.size;
  }

  idle(): number {
    return this.idleConns.length;
  }

  // The extension round: close the coldest idle connections past a limit.
  shrink(maxIdle: number): number {
    if (maxIdle < 0) throw new RangeError("maxIdle is not negative");
    const closing = Math.max(this.idleConns.length - maxIdle, 0);
    this.idleConns = this.idleConns.slice(closing);
    return closing;
  }
}
