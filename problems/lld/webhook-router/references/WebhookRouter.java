import java.util.*;
import java.util.function.Function;

public class WebhookRouter {
  private interface Matcher {
    boolean matches(String event);
  }

  private record Exact(String name) implements Matcher {
    public boolean matches(String event) {
      return event.equals(name);
    }
  }

  private record Prefix(String prefix) implements Matcher {
    public boolean matches(String event) {
      return event.startsWith(prefix);
    }
  }

  private record Anything() implements Matcher {
    public boolean matches(String event) {
      return true;
    }
  }

  // Each kind of matcher recognises its own patterns. A new kind is a new entry here and a
  // new class; the router and the existing kinds never change.
  private static final List<Function<String, Matcher>> KINDS =
      List.of(
          pattern -> pattern.contains("*") ? null : new Exact(pattern),
          pattern -> {
            String stem = pattern.endsWith(".*") ? pattern.substring(0, pattern.length() - 2) : "";
            return !stem.isEmpty() && !stem.contains("*") ? new Prefix(stem + ".") : null;
          },
          pattern -> pattern.equals("*") ? new Anything() : null);

  private static Matcher matcher(String pattern) {
    for (Function<String, Matcher> kind : KINDS) {
      Matcher found = kind.apply(pattern);
      if (found != null) return found;
    }
    throw new IllegalArgumentException("not a pattern");
  }

  private static String named(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("an empty name");
    return text;
  }

  private record Route(String pattern, String handler, Matcher matcher) {}

  private List<Route> routes = new ArrayList<>();
  private final Map<String, Map<String, Matcher>> exclusions = new HashMap<>();

  public WebhookRouter() {}

  public void route(String pattern, String handler) {
    Matcher found = matcher(named(pattern));
    named(handler);
    for (Route r : routes) if (r.pattern().equals(pattern) && r.handler().equals(handler)) return;
    routes.add(new Route(pattern, handler, found));
  }

  public List<String> deliver(String event) {
    if (named(event).contains("*")) throw new IllegalArgumentException("an event has no wildcard");
    List<String> handlers = new ArrayList<>();
    for (Route route : routes)
      if (!handlers.contains(route.handler())
          && route.matcher().matches(event)
          && !excluded(route.handler(), event)) handlers.add(route.handler());
    return handlers;
  }

  public long unroute(String handler) {
    named(handler);
    List<Route> kept = new ArrayList<>();
    for (Route r : routes) if (!r.handler().equals(handler)) kept.add(r);
    long removed = routes.size() - kept.size();
    routes = kept;
    exclusions.remove(handler);
    return removed;
  }

  // The extension round: a negative matcher is any matcher, used to skip a handler.
  public void exclude(String handler, String pattern) {
    Matcher found = matcher(named(pattern));
    exclusions.computeIfAbsent(named(handler), h -> new HashMap<>()).putIfAbsent(pattern, found);
  }

  private boolean excluded(String handler, String event) {
    for (Matcher m : exclusions.getOrDefault(handler, Map.of()).values())
      if (m.matches(event)) return true;
    return false;
  }
}
