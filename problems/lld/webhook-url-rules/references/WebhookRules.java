import java.util.*;

public class WebhookRules {
  private static final int MAX_LENGTH = 200;

  // The one place the URL rules live. Every entry point asks it, so a new rule is one
  // change here and can never apply at one entry point and not another.
  private static final class UrlPolicy {
    private final Set<String> blocked = new HashSet<>();

    void block(String host) {
      blocked.add(host.toLowerCase(Locale.ROOT));
    }

    List<String> violations(String url) {
      if (url.isEmpty()) throw new IllegalArgumentException("a URL is not empty");
      String host = hostOf(url);
      List<String> found = new ArrayList<>();
      if (url.length() > MAX_LENGTH) found.add("length");
      if (!url.startsWith("https://")) found.add("scheme");
      if (internal(host)) found.add("host");
      if (blocked.contains(host)) found.add("blocked");
      return found;
    }

    // The URL's host in lower case: after the first "://", up to the path, query or
    // fragment, without a port. Empty when there's no "://".
    private static String hostOf(String url) {
      int at = url.indexOf("://");
      if (at < 0) return "";
      String rest = url.substring(at + 3);
      for (String stop : new String[] {"/", "?", "#", ":"}) {
        int cut = rest.indexOf(stop);
        if (cut >= 0) rest = rest.substring(0, cut);
      }
      return rest.toLowerCase(Locale.ROOT);
    }

    private static int[] ipv4(String host) {
      String[] parts = host.split("\\.", -1);
      if (parts.length != 4) return null;
      int[] numbers = new int[4];
      for (int i = 0; i < 4; i++) {
        if (!parts[i].matches("[0-9]{1,3}")) return null;
        numbers[i] = Integer.parseInt(parts[i]);
        if (numbers[i] > 255) return null;
      }
      return numbers;
    }

    private static boolean internal(String host) {
      if (host.isEmpty() || host.equals("localhost")) return true;
      int[] ip = ipv4(host);
      if (ip == null) return false;
      return ip[0] == 10
          || ip[0] == 127
          || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
          || (ip[0] == 192 && ip[1] == 168);
    }
  }

  private final UrlPolicy policy = new UrlPolicy();
  private final Map<String, String> urls = new LinkedHashMap<>(); // id -> URL, in creation order

  public WebhookRules() {}

  public List<String> createHook(String url) {
    List<String> found = policy.violations(url);
    if (found.isEmpty()) urls.put("hook-" + (urls.size() + 1), url);
    return found;
  }

  public List<String> updateHook(String hookId, String url) {
    if (!urls.containsKey(hookId)) throw new NoSuchElementException("no such hook");
    List<String> found = policy.violations(url);
    if (found.isEmpty()) urls.put(hookId, url);
    return found;
  }

  public List<String> testUrl(String url) {
    return policy.violations(url);
  }

  public List<String> hooks() {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, String> e : urls.entrySet()) out.add(e.getKey() + " " + e.getValue());
    return out;
  }

  // The extension round: one more rule, in the one place rules live.
  public void blockHost(String host) {
    if (host.isEmpty()) throw new IllegalArgumentException("a host is not empty");
    policy.block(host);
  }
}
