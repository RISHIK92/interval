import java.util.*;

public class Leaderboard {
  private final Map<String, Long> totals = new HashMap<>();

  private List<String> ordered() {
    List<String> players = new ArrayList<>(totals.keySet());
    players.sort(
        Comparator.comparing((String p) -> -totals.get(p)).thenComparing(Comparator.naturalOrder()));
    return players;
  }

  public synchronized long add(String player, long points) {
    if (points <= 0) throw new IllegalArgumentException("points must be positive");
    return totals.merge(player, points, Long::sum);
  }

  public synchronized List<String> top(long k) {
    if (k < 0) throw new IllegalArgumentException("negative k");
    List<String> players = ordered();
    return new ArrayList<>(players.subList(0, (int) Math.min(k, players.size())));
  }

  public synchronized Long rank(String player) {
    if (!totals.containsKey(player)) return null;
    return (long) ordered().indexOf(player) + 1;
  }

  public synchronized boolean remove(String player) {
    return totals.remove(player) != null;
  }
}
