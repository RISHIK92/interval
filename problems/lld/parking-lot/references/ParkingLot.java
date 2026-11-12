import java.util.*;

public class ParkingLot {
  private record Spot(String kind, long number) {
    String label() {
      return (kind.equals("small") ? "S" : "L") + number;
    }
  }

  // Free spot numbers per size: the lowest is always first.
  private final Map<String, TreeSet<Long>> spots = new HashMap<>();
  private final Map<String, Spot> cars = new HashMap<>();
  // The extension round: spots out of use, and how many of each size exist.
  private final Set<Spot> blocked = new HashSet<>();
  private final Map<String, Long> counts = new HashMap<>();

  public ParkingLot(long small, long large) {
    if (small < 0 || large < 0) throw new IllegalArgumentException("negative spot count");
    counts.put("small", small);
    counts.put("large", large);
    spots.put("small", new TreeSet<>());
    spots.put("large", new TreeSet<>());
    for (long i = 1; i <= small; i++) spots.get("small").add(i);
    for (long i = 1; i <= large; i++) spots.get("large").add(i);
  }

  private TreeSet<Long> spotsOf(String size) {
    TreeSet<Long> s = spots.get(size);
    if (s == null) throw new IllegalArgumentException("unknown size");
    return s;
  }

  public synchronized String park(String plate, String size) {
    spotsOf(size);
    if (cars.containsKey(plate)) throw new IllegalStateException("already parked");
    for (String kind : size.equals("small") ? List.of("small", "large") : List.of("large")) {
      TreeSet<Long> s = spots.get(kind);
      if (s.isEmpty()) continue;
      Spot spot = new Spot(kind, s.pollFirst());
      cars.put(plate, spot);
      return spot.label();
    }
    return null;
  }

  public synchronized String leave(String plate) {
    Spot spot = cars.remove(plate);
    if (spot == null) return null;
    spots.get(spot.kind()).add(spot.number());
    return spot.label();
  }

  public synchronized String where(String plate) {
    Spot spot = cars.get(plate);
    return spot == null ? null : spot.label();
  }

  private Spot spotOf(String spot) {
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("([SL])([1-9][0-9]*)").matcher(spot);
    if (!m.matches()) throw new IllegalArgumentException("unknown spot");
    String kind = m.group(1).equals("S") ? "small" : "large";
    long number;
    try {
      number = Long.parseLong(m.group(2));
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("unknown spot");
    }
    if (number > counts.get(kind)) throw new IllegalArgumentException("unknown spot");
    return new Spot(kind, number);
  }

  public synchronized boolean block(String spot) {
    Spot s = spotOf(spot);
    if (!spots.get(s.kind()).remove(s.number())) return false;
    blocked.add(s);
    return true;
  }

  public synchronized boolean unblock(String spot) {
    Spot s = spotOf(spot);
    if (!blocked.remove(s)) return false;
    spots.get(s.kind()).add(s.number());
    return true;
  }

  public synchronized long free(String size) {
    return spotsOf(size).size();
  }
}
