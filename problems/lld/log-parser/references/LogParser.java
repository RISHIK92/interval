import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LogParser {
  private static final Pattern ACCESS =
      Pattern.compile(
          "([^ ]+) ([^ ]+) ([^ ]+) \\[([^\\]]+)\\] \"([^ \"]+) ([^ \"]+) ([^ \"]+)\" ([0-9]{3}) ([0-9]+|-)");
  private static final String[] ACCESS_KEYS = {
    "host", "ident", "user", "time", "method", "path", "protocol", "status", "bytes"
  };

  // One named way to read a line. Each kind reads it its own way.
  private abstract static class Format {
    long count;

    // The line's fields, or null when it's malformed for this kind.
    abstract Map<String, String> fields(String line);
  }

  private static final class KeyValueFormat extends Format {
    Map<String, String> fields(String line) {
      Map<String, String> out = new HashMap<>();
      for (String token : line.split(" ", -1)) {
        int at = token.indexOf('=');
        if (at <= 0) return null;
        String key = token.substring(0, at);
        if (out.containsKey(key)) return null;
        out.put(key, token.substring(at + 1));
      }
      return out;
    }
  }

  private static final class CsvFormat extends Format {
    private final List<String> headers;

    CsvFormat(List<String> headers) {
      this.headers = new ArrayList<>(headers);
    }

    Map<String, String> fields(String line) {
      String[] values = line.split(",", -1);
      if (values.length != headers.size()) return null;
      Map<String, String> out = new HashMap<>();
      for (int i = 0; i < values.length; i++) out.put(headers.get(i), values[i]);
      return out;
    }
  }

  private static final class AccessFormat extends Format {
    Map<String, String> fields(String line) {
      Matcher match = ACCESS.matcher(line);
      if (!match.matches()) return null;
      Map<String, String> out = new HashMap<>();
      for (int i = 0; i < ACCESS_KEYS.length; i++) out.put(ACCESS_KEYS[i], match.group(i + 1));
      return out;
    }
  }

  private final Map<String, Format> formats = new LinkedHashMap<>();

  private Format format(String name) {
    Format format = formats.get(name);
    if (format == null) throw new NoSuchElementException("no such format");
    return format;
  }

  public void addFormat(String name, String kind, List<String> headers) {
    if (name.isEmpty() || formats.containsKey(name))
      throw new IllegalArgumentException("a format needs a new, non-empty name");
    Format format;
    if (kind.equals("csv")) {
      if (headers.isEmpty()
          || headers.size() > 20
          || headers.contains("")
          || new HashSet<>(headers).size() != headers.size())
        throw new IllegalArgumentException("1-20 distinct, non-empty headers");
      format = new CsvFormat(headers);
    } else if (kind.equals("kv") && headers.isEmpty()) format = new KeyValueFormat();
    else if (kind.equals("access") && headers.isEmpty()) format = new AccessFormat();
    else throw new IllegalArgumentException("unknown kind, or headers where none are taken");
    formats.put(name, format);
  }

  public Map<String, String> parse(String format, String line) {
    Format chosen = format(format);
    Map<String, String> fields = chosen.fields(line);
    if (fields == null) throw new IllegalArgumentException("malformed line");
    chosen.count++;
    return fields;
  }

  public long parsed(String format) {
    return format(format).count;
  }

  // The extension round.
  public String detect(String line) {
    for (Map.Entry<String, Format> e : formats.entrySet())
      if (e.getValue().fields(line) != null) return e.getKey();
    return null;
  }
}
