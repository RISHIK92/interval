import java.util.*;

public class MeetingRooms {
  // Each room's meetings, start -> end.
  private final List<Map<Long, Long>> rooms = new ArrayList<>();

  public MeetingRooms(long count) {
    if (count < 1) throw new IllegalArgumentException("count must be at least 1");
    for (long i = 0; i < count; i++) rooms.add(new HashMap<>());
  }

  public synchronized Long book(long start, long end) {
    if (end <= start) throw new IllegalArgumentException("end must be after start");
    for (int i = 0; i < rooms.size(); i++) {
      Map<Long, Long> meetings = rooms.get(i);
      boolean clear = true;
      for (Map.Entry<Long, Long> m : meetings.entrySet())
        if (start < m.getValue() && m.getKey() < end) clear = false;
      if (!clear) continue;
      meetings.put(start, end);
      return (long) i + 1;
    }
    return null;
  }

  public synchronized boolean cancel(long room, long start) {
    if (room < 1 || room > rooms.size()) return false;
    return rooms.get((int) room - 1).remove(start) != null;
  }

  // The extension round.
  public synchronized boolean extend(long room, long start, long end) {
    if (end <= start) throw new IllegalArgumentException("end must be after start");
    if (room < 1 || room > rooms.size()) return false;
    Map<Long, Long> meetings = rooms.get((int) room - 1);
    if (!meetings.containsKey(start)) return false;
    // Against the room's other meetings only: shrinking always fits.
    for (Map.Entry<Long, Long> m : meetings.entrySet())
      if (m.getKey() != start && start < m.getValue() && m.getKey() < end) return false;
    meetings.put(start, end);
    return true;
  }

  public synchronized long free(long at) {
    long free = 0;
    for (Map<Long, Long> meetings : rooms) {
      boolean busy = false;
      for (Map.Entry<Long, Long> m : meetings.entrySet())
        if (m.getKey() <= at && at < m.getValue()) busy = true;
      if (!busy) free++;
    }
    return free;
  }
}
