import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Function;

public class PayloadPipeline {
  private static final int MAX_LAYERS = 8;
  private static final String HEX = "0123456789abcdef";

  // What any layer can be given to encode: non-empty printable ASCII.
  private static boolean isPayload(String text) {
    return !text.isEmpty() && text.chars().allMatch(c -> c >= ' ' && c <= '~');
  }

  interface Codec {
    String encode(String text);

    String decode(String text);
  }

  // The innermost codec: the text as it is.
  private static final class Plain implements Codec {
    public String encode(String text) {
      return text;
    }

    public String decode(String text) {
      return text;
    }
  }

  // A decorator: it wraps another codec and adds one step on the outside. Decoding accepts
  // only what encoding could have produced: whatever unwrap gives back must be a valid
  // payload that wraps to exactly the input again.
  private abstract static class Layer implements Codec {
    private final Codec inner;

    Layer(Codec inner) {
      this.inner = inner;
    }

    abstract String wrap(String text);

    abstract String unwrap(String text);

    public String encode(String text) {
      return wrap(inner.encode(text));
    }

    public String decode(String text) {
      String raw = unwrap(text);
      if (!isPayload(raw) || !wrap(raw).equals(text))
        throw new IllegalArgumentException("not something this layer produced");
      return inner.decode(raw);
    }
  }

  private static final class Base64Layer extends Layer {
    Base64Layer(Codec inner) {
      super(inner);
    }

    String wrap(String text) {
      return Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.ISO_8859_1));
    }

    String unwrap(String text) {
      return new String(Base64.getDecoder().decode(text), StandardCharsets.ISO_8859_1);
    }
  }

  private static final class Hex extends Layer {
    Hex(Codec inner) {
      super(inner);
    }

    String wrap(String text) {
      StringBuilder out = new StringBuilder();
      for (char c : text.toCharArray()) out.append(HEX.charAt(c >> 4)).append(HEX.charAt(c & 15));
      return out.toString();
    }

    String unwrap(String text) {
      if (text.length() % 2 != 0) throw new IllegalArgumentException("odd hex");
      StringBuilder out = new StringBuilder();
      for (int i = 0; i < text.length(); i += 2) {
        int hi = Character.digit(text.charAt(i), 16);
        int lo = Character.digit(text.charAt(i + 1), 16);
        if (hi < 0 || lo < 0) throw new IllegalArgumentException("not hex");
        out.append((char) (hi * 16 + lo));
      }
      return out.toString();
    }
  }

  // A length prefix: "<length>:<text>".
  private static final class Frame extends Layer {
    Frame(Codec inner) {
      super(inner);
    }

    String wrap(String text) {
      return text.length() + ":" + text;
    }

    String unwrap(String text) {
      int colon = text.indexOf(':');
      return colon < 0 ? "" : text.substring(colon + 1);
    }
  }

  // The extension's layer: one check digit, the sum of the character codes mod 10.
  private static final class Checksum extends Layer {
    Checksum(Codec inner) {
      super(inner);
    }

    String wrap(String text) {
      return text + text.chars().sum() % 10;
    }

    String unwrap(String text) {
      return text.substring(0, text.length() - 1);
    }
  }

  private static final Map<String, Function<Codec, Layer>> LAYERS =
      Map.of("base64", Base64Layer::new, "hex", Hex::new, "frame", Frame::new);

  private Codec codec = new Plain();
  private final List<String> names = new ArrayList<>();

  public void push(String layer) {
    Function<Codec, Layer> found = LAYERS.get(layer);
    if (found == null) throw new IllegalArgumentException("unknown layer");
    add(layer, found);
  }

  public String encode(String text) {
    if (!isPayload(text)) throw new IllegalArgumentException("not a payload");
    return codec.encode(text);
  }

  public String decode(String text) {
    if (!isPayload(text)) throw new IllegalArgumentException("not a payload");
    return codec.decode(text);
  }

  public List<String> layers() {
    return new ArrayList<>(names);
  }

  // The extension round: a layer that catches corruption.
  public void checksum() {
    add("checksum", Checksum::new);
  }

  private void add(String name, Function<Codec, Layer> layer) {
    if (names.size() >= MAX_LAYERS) throw new IllegalArgumentException("too many layers");
    codec = layer.apply(codec);
    names.add(name);
  }
}
