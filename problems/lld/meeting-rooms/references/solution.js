"use strict";

class MeetingRooms {
  constructor(count) {
    if (count < 1) throw new RangeError("count must be at least 1");
    // Each room's meetings, start -> end.
    this.rooms = Array.from({ length: count }, () => new Map());
  }

  book(start, end) {
    if (end <= start) throw new RangeError("end must be after start");
    const room = this.rooms.findIndex((meetings) =>
      [...meetings].every(([s, e]) => end <= s || e <= start),
    );
    if (room === -1) return null;
    this.rooms[room].set(start, end);
    return room + 1;
  }

  cancel(room, start) {
    if (room < 1 || room > this.rooms.length) return false;
    return this.rooms[room - 1].delete(start);
  }

  // The extension round.
  extend(room, start, end) {
    if (end <= start) throw new RangeError("end must be after start");
    if (room < 1 || room > this.rooms.length) return false;
    const meetings = this.rooms[room - 1];
    if (!meetings.has(start)) return false;
    // Against the room's other meetings only: shrinking always fits.
    for (const [s, e] of meetings)
      if (s !== start && start < e && s < end) return false;
    meetings.set(start, end);
    return true;
  }

  free(at) {
    return this.rooms.filter(
      (meetings) => ![...meetings].some(([s, e]) => s <= at && at < e),
    ).length;
  }
}

module.exports = { MeetingRooms };
