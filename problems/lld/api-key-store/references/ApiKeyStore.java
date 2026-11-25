import java.util.*;

public class ApiKeyStore {
  private static final long MAX_NOW = 10_000_000_000_000L;
  private static final long MAX_TTL = 1_000_000_000_000L;
  private static final long GRACE_MS = 60_000L;

  private static final class Key {
    final String owner;
    final long ttl;
    List<String> grant;
    long expires;
    boolean revoked, rotated;

    Key(String owner, List<String> grant, long now, long ttl) {
      this.owner = owner;
      this.grant = grant;
      this.ttl = ttl;
      this.expires = now + ttl;
    }

    boolean live(long now) {
      return !revoked && now < expires;
    }
  }

  private final Map<String, Key> keys = new HashMap<>();

  public ApiKeyStore() {}

  private static void checked(String scope, boolean wildcard) {
    if (!scope.matches(wildcard ? "[a-z]+:([a-z]+|\\*)" : "[a-z]+:[a-z]+"))
      throw new IllegalArgumentException("a scope is resource:action");
  }

  private static List<String> grantOf(List<String> scopes) {
    if (scopes.size() < 1 || scopes.size() > 20) throw new IllegalArgumentException("1 to 20 scopes");
    for (String s : scopes) checked(s, true);
    return List.copyOf(scopes);
  }

  private static boolean covers(List<String> grant, String scope) {
    String resource = scope.substring(0, scope.indexOf(':'));
    return grant.contains(scope) || grant.contains(resource + ":*");
  }

  private String add(String owner, List<String> grant, long now, long ttl) {
    String id = "key-" + (keys.size() + 1);
    keys.put(id, new Key(owner, grant, now, ttl));
    return id;
  }

  public String issue(String owner, List<String> scopes, long nowMs, long ttlMs) {
    List<String> grant = grantOf(scopes);
    if (owner.isEmpty() || nowMs < 0 || nowMs > MAX_NOW || ttlMs < 1 || ttlMs > MAX_TTL)
      throw new IllegalArgumentException("an owner, a time and a time to live");
    return add(owner, grant, nowMs, ttlMs);
  }

  public boolean can(String keyId, String scope, long nowMs) {
    checked(scope, false);
    Key key = keys.get(keyId);
    return key != null && key.live(nowMs) && covers(key.grant, scope);
  }

  public boolean narrow(String keyId, List<String> scopes) {
    List<String> grant = grantOf(scopes);
    Key key = keys.get(keyId);
    if (key == null || key.revoked) return false;
    for (String s : grant) if (!covers(key.grant, s)) return false;
    key.grant = grant;
    return true;
  }

  public boolean revoke(String keyId) {
    Key key = keys.get(keyId);
    if (key == null || key.revoked) return false;
    key.revoked = true;
    return true;
  }

  // The extension round.
  public String rotate(String keyId, long nowMs) {
    Key key = keys.get(keyId);
    if (key == null || key.rotated || nowMs < 0 || nowMs > MAX_NOW || !key.live(nowMs))
      throw new IllegalArgumentException("only a live key is rotated, once");
    key.rotated = true;
    key.expires = Math.min(key.expires, nowMs + GRACE_MS);
    return add(key.owner, key.grant, nowMs, key.ttl);
  }
}
