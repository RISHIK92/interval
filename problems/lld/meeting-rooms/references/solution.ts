export class MeetingRooms {
  // Each room's meetings, start -> end.
  private readonly rooms: Map<number, number>[];

  constructor(count: number) {
    if (count < 1) throw new RangeError("count must be at least 1");
    this.rooms = Array.from({ length: count }, () => new Map<number, number>());
  }

  book(start: number, end: number): number | null {
    if (end <= start) throw new RangeError("end must be after start");
    const room = this.rooms.findIndex((meetings) =>
      [...meetings].every(([s, e]) => end <= s || e <= start),
    );
    if (room === -1) return null;
    this.rooms[room]?.set(start, end);
    return room + 1;
  }

  cancel(room: number, start: number): boolean {
    return this.rooms[room - 1]?.delete(start) ?? false;
  }

  free(at: number): number {
    return this.rooms.filter(
      (meetings) => ![...meetings].some(([s, e]) => s <= at && at < e),
    ).length;
  }
}
