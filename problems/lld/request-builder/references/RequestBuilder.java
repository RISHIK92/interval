import java.util.*;
import java.util.regex.Pattern;

public class RequestBuilder {
  private static final Set<String> METHODS =
      Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
  private static final Set<String> BODILESS = Set.of("GET", "HEAD");
  private static final Pattern URL = Pattern.compile("https?://[^?# ]+");
  private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9-]+");

  // What build produces: a record of an unmodifiable list, so nothing can change a
  // request once it is built.
  private record Request(List<String> lines) {}

  private static void filled(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("not empty");
  }

  private static String canonical(String name) {
    if (!TOKEN.matcher(name).matches())
      throw new IllegalArgumentException("a header name is letters, digits and dashes");
    StringBuilder out = new StringBuilder();
    boolean start = true;
    for (char c : name.toCharArray()) {
      out.append(start ? Character.toUpperCase(c) : Character.toLowerCase(c));
      start = c == '-';
    }
    return out.toString();
  }

  private static String encode(String text) {
    StringBuilder out = new StringBuilder();
    for (char c : text.toCharArray()) {
      if (Character.isLetterOrDigit(c) && c < 128 || "-._~".indexOf(c) >= 0) out.append(c);
      else out.append(String.format("%%%02X", (int) c));
    }
    return out.toString();
  }

  private final String method;
  private final String url;
  private final Map<String, String> headers = new HashMap<>();
  private final List<String> pairs = new ArrayList<>();
  private String text;
  private Request built;

  public RequestBuilder(String method, String url) {
    if (!METHODS.contains(method)) throw new IllegalArgumentException("unknown method");
    if (!URL.matcher(url).matches()) throw new IllegalArgumentException("bad url");
    this.method = method;
    this.url = url;
  }

  private void open() {
    if (built != null) throw new IllegalStateException("the request is built");
  }

  public void header(String name, String value) {
    open();
    String key = canonical(name);
    if (key.equals("Content-Length"))
      throw new IllegalArgumentException("the length is set automatically");
    String trimmed = value.replaceAll("^ +| +$", "");
    filled(trimmed);
    headers.put(key, trimmed);
  }

  public void query(String key, String value) {
    open();
    filled(key);
    filled(value);
    pairs.add(encode(key) + "=" + encode(value));
  }

  public void body(String text) {
    open();
    filled(text);
    this.text = text;
  }

  public List<String> build() {
    if (built == null) {
      if (text != null && BODILESS.contains(method))
        throw new IllegalStateException("this method takes no body");
      TreeMap<String, String> sorted = new TreeMap<>(headers);
      if (text != null) sorted.put("Content-Length", String.valueOf(text.length()));
      List<String> lines = new ArrayList<>();
      lines.add(method + " " + url + (pairs.isEmpty() ? "" : "?" + String.join("&", pairs)));
      for (Map.Entry<String, String> e : sorted.entrySet()) lines.add(e.getKey() + ": " + e.getValue());
      lines.add("");
      lines.add(text == null ? "" : text);
      built = new Request(List.copyOf(lines));
    }
    return built.lines();
  }

  // The extension round: a shortcut that won't stack a second credential.
  public boolean bearer(String token) {
    open();
    filled(token);
    if (token.contains(" ")) throw new IllegalArgumentException("a token has no spaces");
    if (headers.containsKey("Authorization")) return false;
    headers.put("Authorization", "Bearer " + token);
    return true;
  }
}
