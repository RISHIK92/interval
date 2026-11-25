// The columns, in board order: a ticket moves only to a neighbour.
const COLUMNS = ["todo", "doing", "review", "done"] as const;
type Column = (typeof COLUMNS)[number];

type Ticket = { points: number; column: Column; reason: string | null };

export class SprintBoard {
  private readonly limit: number;
  // Insertion order is ticket-number order.
  private readonly tickets = new Map<string, Ticket>();

  constructor(wipLimit: number) {
    if (wipLimit < 1 || wipLimit > 100)
      throw new RangeError("wipLimit must be within 1-100");
    this.limit = wipLimit;
  }

  private ticket(ticket: string): Ticket {
    const t = this.tickets.get(ticket);
    if (t === undefined) throw new RangeError("no such ticket");
    return t;
  }

  private in(column: Column): Ticket[] {
    return [...this.tickets.values()].filter((t) => t.column === column);
  }

  add(title: string, points: number): string {
    if (title === "" || points < 1 || points > 100)
      throw new RangeError("a ticket needs a title and 1-100 points");
    const ticket = `T-${String(this.tickets.size + 1)}`;
    this.tickets.set(ticket, { points, column: "todo", reason: null });
    return ticket;
  }

  move(ticket: string, column: string): boolean {
    const t = this.ticket(ticket);
    const to = COLUMNS.find((c) => c === column);
    if (to === undefined) throw new RangeError("no such column");
    const step = COLUMNS.indexOf(to) - COLUMNS.indexOf(t.column);
    if (Math.abs(step) !== 1 || t.reason !== null) return false;
    if (to === "doing" && this.in("doing").length >= this.limit) return false;
    t.column = to;
    return true;
  }

  column(ticket: string): string {
    return this.ticket(ticket).column;
  }

  velocity(): number {
    return this.in("done").reduce((sum, t) => sum + t.points, 0);
  }

  // The extension round.
  block(ticket: string, reason: string): void {
    const t = this.ticket(ticket);
    if (reason === "") throw new RangeError("a block needs a reason");
    t.reason = reason;
  }

  unblock(ticket: string): void {
    this.ticket(ticket).reason = null;
  }

  blocked(): string[] {
    const out: string[] = [];
    for (const [k, t] of this.tickets)
      if (t.reason !== null) out.push(`${k}: ${t.reason}`);
    return out;
  }
}
