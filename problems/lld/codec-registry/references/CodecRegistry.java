import java.util.*;
import java.util.function.Supplier;
import java.util.regex.Pattern;

public class CodecRegistry {
  private static final String TOKEN = "[a-z0-9][a-z0-9.+-]*";
  private static final Pattern CONTENT_TYPE = Pattern.compile(TOKEN + "/" + TOKEN);
  private static final Pattern MEDIA_RANGE =
      Pattern.compile("\\*/\\*|" + TOKEN + "/\\*|" + TOKEN + "/" + TOKEN);
  private static final Pattern QUALITY = Pattern.compile("0(\\.[0-9]{0,3})?|1(\\.0{0,3})?");
  private static final String UNRESERVED =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  // What the registry needs from a codec: turn a flat record into text. Fields arrive
  // sorted by name, so every codec writes them in the same order.
  private interface Codec {
    String encode(List<Map.Entry<String, String>> fields);
  }

  private static final class JsonCodec implements Codec {
    private static String quoted(String text) {
      return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    public String encode(List<Map.Entry<String, String>> fields) {
      StringJoiner out = new StringJoiner(",", "{", "}");
      for (var f : fields) out.add(quoted(f.getKey()) + ":" + quoted(f.getValue()));
      return out.toString();
    }
  }

  private static final class FormCodec implements Codec {
    private static String escaped(String text) {
      StringBuilder out = new StringBuilder();
      for (char c : text.toCharArray()) {
        if (UNRESERVED.indexOf(c) >= 0) out.append(c);
        else out.append(String.format("%%%02X", (int) c));
      }
      return out.toString();
    }

    public String encode(List<Map.Entry<String, String>> fields) {
      StringJoiner out = new StringJoiner("&");
      for (var f : fields) out.add(escaped(f.getKey()) + "=" + escaped(f.getValue()));
      return out.toString();
    }
  }

  private static final class CsvCodec implements Codec {
    private static String cell(String text) {
      if (text.contains(",") || text.contains("\"")) return "\"" + text.replace("\"", "\"\"") + "\"";
      return text;
    }

    public String encode(List<Map.Entry<String, String>> fields) {
      StringJoiner header = new StringJoiner(",");
      StringJoiner values = new StringJoiner(",");
      for (var f : fields) {
        header.add(cell(f.getKey()));
        values.add(cell(f.getValue()));
      }
      return header + "\n" + values;
    }
  }

  // The factory method's table: a codec's name makes its codec, and nothing else in the
  // registry knows the concrete classes. A new format is a class and a line here.
  private static final Map<String, Supplier<Codec>> CODECS =
      Map.of("json", JsonCodec::new, "form", FormCodec::new, "csv", CsvCodec::new);

  private static Codec makeCodec(String name) {
    Supplier<Codec> made = CODECS.get(name);
    if (made == null) throw new IllegalArgumentException("unknown codec");
    return made.get();
  }

  // A q-value in thousandths, so no float is ever compared.
  private static long quality(String text) {
    if (!QUALITY.matcher(text).matches()) throw new IllegalArgumentException("bad q-value");
    int dot = text.indexOf('.');
    String whole = dot < 0 ? text : text.substring(0, dot);
    String fraction = dot < 0 ? "" : text.substring(dot + 1);
    return Long.parseLong(whole) * 1000 + Long.parseLong((fraction + "000").substring(0, 3));
  }

  private static Map<String, Long> parseRanges(String accept) {
    Map<String, Long> ranges = new HashMap<>();
    for (String item : accept.split(",", -1)) {
      String[] parts = item.split(";", -1);
      for (int i = 0; i < parts.length; i++) parts[i] = parts[i].replaceAll("^ +| +$", "");
      String media = parts[0];
      if (!MEDIA_RANGE.matcher(media).matches() || ranges.containsKey(media) || parts.length > 2)
        throw new IllegalArgumentException("bad media range");
      long q = 1000;
      if (parts.length == 2) {
        if (!parts[1].startsWith("q=")) throw new IllegalArgumentException("only q is allowed");
        q = quality(parts[1].substring(2));
      }
      ranges.put(media, q);
    }
    return ranges;
  }

  private final Map<String, Codec> codecs = new LinkedHashMap<>(); // in the order they were added
  private String fallback = null;

  public void add(String contentType, String codec) {
    if (!CONTENT_TYPE.matcher(contentType).matches())
      throw new IllegalArgumentException("bad content type");
    if (codecs.containsKey(contentType)) throw new IllegalArgumentException("already added");
    codecs.put(contentType, makeCodec(codec));
  }

  public String negotiate(String accept) {
    Map<String, Long> ranges = parseRanges(accept);
    String best = null;
    long bestQuality = 0;
    for (String contentType : codecs.keySet()) {
      // The most specific range that matches decides, even when it says q=0.
      String top = contentType.substring(0, contentType.indexOf('/'));
      long q = 0;
      for (String range : List.of(contentType, top + "/*", "*/*")) {
        if (ranges.containsKey(range)) {
          q = ranges.get(range);
          break;
        }
      }
      if (q > bestQuality) {
        best = contentType;
        bestQuality = q;
      }
    }
    return best != null ? best : fallback;
  }

  public String encodeWith(String contentType, Map<String, String> fields) {
    Codec codec = codecs.get(contentType);
    if (codec == null) throw new IllegalArgumentException("no codec for that type");
    if (fields.isEmpty() || fields.containsKey("") || fields.containsValue(""))
      throw new IllegalArgumentException("empty record, name or value");
    return codec.encode(new ArrayList<>(new TreeMap<>(fields).entrySet()));
  }

  // The extension round: a type to answer with when nothing is acceptable.
  public void fallbackType(String contentType) {
    if (!codecs.containsKey(contentType)) throw new IllegalArgumentException("no codec for that type");
    fallback = contentType;
  }
}
