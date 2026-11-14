import java.util.*;

public class UrlShortener {
  private static final String ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // Every live code (generated or custom) to its url and hit count.
  private final Map<String, String> urls = new HashMap<>();
  private final Map<String, Long> counts = new HashMap<>();
  // A url's generated code, so shortening it again gives the same one.
  private final Map<String, String> generated = new HashMap<>();
  private long counter = 1;

  public UrlShortener() {}

  private static void checkUrl(String url) {
    int rest = 0;
    if (url.startsWith("https://")) rest = url.length() - 8;
    else if (url.startsWith("http://")) rest = url.length() - 7;
    if (rest == 0 || url.length() > 2048 || url.indexOf(' ') >= 0) throw new IllegalArgumentException("invalid url");
  }

  private static String encode(long n) {
    StringBuilder out = new StringBuilder();
    while (n > 0) {
      out.insert(0, ALPHABET.charAt((int) (n % 62)));
      n /= 62;
    }
    return out.toString();
  }

  public synchronized String shorten(String url) {
    checkUrl(url);
    String known = generated.get(url);
    if (known != null) return known;
    // A custom alias may already hold the next code: skip it.
    String code;
    do {
      code = encode(counter++);
    } while (urls.containsKey(code));
    urls.put(code, url);
    counts.put(code, 0L);
    generated.put(url, code);
    return code;
  }

  public synchronized String expand(String code) {
    String url = urls.get(code);
    if (url == null) throw new IllegalStateException("unknown code");
    counts.merge(code, 1L, Long::sum);
    return url;
  }

  public synchronized String custom(String url, String alias) {
    checkUrl(url);
    if (alias.isEmpty() || alias.length() > 16) throw new IllegalArgumentException("invalid alias");
    for (char c : alias.toCharArray())
      if (ALPHABET.indexOf(c) < 0) throw new IllegalArgumentException("invalid alias");
    if (urls.containsKey(alias)) throw new IllegalStateException("alias taken");
    urls.put(alias, url);
    counts.put(alias, 0L);
    return alias;
  }

  public synchronized long hits(String code) {
    Long n = counts.get(code);
    if (n == null) throw new IllegalStateException("unknown code");
    return n;
  }

  public synchronized void expire(String code) {
    String url = urls.get(code);
    if (url == null) throw new IllegalStateException("unknown code");
    urls.remove(code);
    counts.remove(code);
    if (code.equals(generated.get(url))) generated.remove(url);
  }
}
