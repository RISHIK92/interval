import java.util.*;

// Teams aggregate engineers: a team holds its members' names in join order, and each
// engineer knows their teams. Disbanding drops only the team's side and the links.
public class OncallRoster {
  private final Map<String, TreeSet<String>> teamsOf = new HashMap<>();
  private final Map<String, List<String>> members = new HashMap<>();
  private final Map<String, Integer> lastOnCall = new HashMap<>();

  public OncallRoster() {}

  private static void named(String... names) {
    for (String n : names) if (n.isEmpty()) throw new IllegalArgumentException("names are not empty");
  }

  public void addEngineer(String name) {
    named(name);
    if (teamsOf.containsKey(name)) throw new IllegalArgumentException("engineer already on the roster");
    teamsOf.put(name, new TreeSet<>());
  }

  public void addTeam(String team) {
    named(team);
    if (members.containsKey(team)) throw new IllegalArgumentException("team already exists");
    members.put(team, new ArrayList<>());
  }

  public boolean join(String team, String name) {
    named(team, name);
    List<String> m = members.get(team);
    TreeSet<String> teams = teamsOf.get(name);
    if (m == null || teams == null) throw new IllegalArgumentException("unknown team or engineer");
    if (!teams.add(team)) return false;
    m.add(name);
    return true;
  }

  public boolean disband(String team) {
    named(team);
    List<String> m = members.remove(team);
    if (m == null) return false;
    for (String name : m) teamsOf.get(name).remove(team);
    lastOnCall.remove(team);
    return true;
  }

  public List<String> teamsOf(String name) {
    named(name);
    TreeSet<String> teams = teamsOf.get(name);
    if (teams == null) throw new IllegalArgumentException("unknown engineer");
    return new ArrayList<>(teams);
  }

  // The extension round: the next on call, in join order.
  public String rotate(String team) {
    named(team);
    List<String> m = members.get(team);
    if (m == null || m.isEmpty()) throw new IllegalArgumentException("unknown team or no members");
    int next = (lastOnCall.getOrDefault(team, -1) + 1) % m.size();
    lastOnCall.put(team, next);
    return m.get(next);
  }
}
