import java.util.*;

// What callers see: the real API and its proxy answer the same call.
interface AdminApi {
  String handle(String user, String action, String target);
}

// A protection proxy: the same call as the real API, but it decides first whether the
// call may go through, and writes every attempt down. A call it stops never reaches the
// real API, which the API's own call count shows.
public class AdminProxy implements AdminApi {
  // Which actions each role may take: the one table a new role is added to.
  private static final Map<String, Set<String>> ROLES =
      Map.of(
          "viewer", Set.of("read"),
          "operator", Set.of("read", "suspend", "restore"),
          "admin", Set.of("read", "suspend", "restore", "delete"));
  private static final Set<String> ACTIONS = Set.of("read", "suspend", "restore", "delete");

  // The real subject. It does whatever it's asked and knows nothing about roles.
  private static final class RealAdminApi implements AdminApi {
    long calls = 0;
    private final Set<String> suspended = new HashSet<>();
    private final Set<String> deleted = new HashSet<>();

    public String handle(String user, String action, String target) {
      calls += 1;
      if (deleted.contains(target)) return "404";
      if (action.equals("suspend")) {
        if (!suspended.add(target)) return "409";
      } else if (action.equals("restore")) {
        if (!suspended.remove(target)) return "409";
      } else if (action.equals("delete")) {
        deleted.add(target);
      }
      return "200";
    }
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private final RealAdminApi api = new RealAdminApi();
  private final Map<String, Set<String>> roles = new HashMap<>();
  private final List<String> log = new ArrayList<>();
  private final Set<String> glass = new HashSet<>();

  public void grant(String user, String role) {
    given(user);
    if (!ROLES.containsKey(role)) throw new IllegalArgumentException("unknown role");
    roles.computeIfAbsent(user, u -> new HashSet<>()).add(role);
  }

  public String handle(String user, String action, String target) {
    // Who you are (authentication) comes before what you may do (authorization).
    Set<String> held = roles.get(user);
    if (held == null) return "401";
    if (glass.contains(user) || held.stream().anyMatch(role -> ROLES.get(role).contains(action)))
      return api.handle(user, action, target);
    return "403";
  }

  public String invoke(String user, String action, String target) {
    given(user);
    if (!ACTIONS.contains(action)) throw new IllegalArgumentException("unknown action");
    given(target);
    String status = handle(user, action, target);
    String line = user + " " + action + " " + target + " " + status;
    log.add(glass.contains(user) ? line + " break-glass" : line);
    return status + " " + action + " " + target;
  }

  public List<String> audit() {
    return new ArrayList<>(log);
  }

  public long realCalls() {
    return api.calls;
  }

  // The extension round: emergency access, marked in the audit.
  public boolean breakGlass(String user) {
    known(user);
    return glass.add(user);
  }

  public boolean endBreakGlass(String user) {
    known(user);
    return glass.remove(user);
  }

  private void known(String user) {
    if (!roles.containsKey(user))
      throw new IllegalArgumentException("break-glass is for users with a grant");
  }
}
