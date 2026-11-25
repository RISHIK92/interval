import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SinkFactory {
  private static final Pattern FILE = Pattern.compile("file:(/[^ ]*)");
  private static final Pattern SYSLOG = Pattern.compile("syslog:([A-Za-z0-9.-]+):([1-9][0-9]{0,4})");
  private static final int PORT_LIMIT = 65535;

  // What every product of the factory can do. Callers hold a sink id and never learn
  // which class is behind it.
  private interface Sink {
    String kind();

    String write(String line);
  }

  private static final class StdoutSink implements Sink {
    public String kind() {
      return "stdout";
    }

    public String write(String line) {
      return line;
    }
  }

  private static final class FileSink implements Sink {
    private final String path;
    private long written;

    FileSink(String path) {
      this.path = path;
    }

    public String kind() {
      return "file";
    }

    public String write(String line) {
      written += 1;
      return path + ":" + written + " " + line;
    }
  }

  private static final class SyslogSink implements Sink {
    private final String address;

    SyslogSink(String host, int port) {
      address = host + ":" + port;
    }

    public String kind() {
      return "syslog";
    }

    public String write(String line) {
      return "<14>" + address + " " + line;
    }
  }

  private static final class BufferedSink implements Sink {
    private final int capacity;
    private final ArrayDeque<String> held = new ArrayDeque<>();

    BufferedSink(int capacity) {
      this.capacity = capacity;
    }

    public String kind() {
      return "buffered";
    }

    public String write(String line) {
      held.addLast(line);
      if (held.size() > capacity) held.removeFirst();
      return "";
    }

    List<String> drain() {
      List<String> out = new ArrayList<>(held);
      held.clear();
      return out;
    }
  }

  // The creation step, a parameterised factory (the simple form of factory method): the
  // spec decides which class to make, and only here.
  private static Sink parse(String spec) {
    if (spec.equals("stdout")) return new StdoutSink();
    Matcher file = FILE.matcher(spec);
    if (file.matches() && !spec.endsWith("/")) return new FileSink(file.group(1));
    Matcher syslog = SYSLOG.matcher(spec);
    if (syslog.matches() && Integer.parseInt(syslog.group(2)) <= PORT_LIMIT)
      return new SyslogSink(syslog.group(1), Integer.parseInt(syslog.group(2)));
    throw new IllegalArgumentException("malformed spec");
  }

  private static void filled(String text) {
    if (text.isEmpty()) throw new IllegalArgumentException("not empty");
  }

  private final Map<String, Sink> sinks = new HashMap<>();
  private final Map<String, Long> made = new HashMap<>();

  private String keep(Sink sink) {
    long number = made.merge(sink.kind(), 1L, Long::sum);
    String id = sink.kind() + "-" + number;
    sinks.put(id, sink);
    return id;
  }

  private Sink find(String sink) {
    Sink found = sinks.get(sink);
    if (found == null) throw new NoSuchElementException("unknown sink");
    return found;
  }

  public String create(String spec) {
    return keep(parse(spec));
  }

  public String kindOf(String sink) {
    return find(sink).kind();
  }

  public String writeLine(String sink, String line) {
    Sink found = find(sink);
    filled(line);
    return found.write(line);
  }

  public long created(String kind) {
    filled(kind);
    return made.getOrDefault(kind, 0L);
  }

  // The extension round: one more product, made by its own method.
  public String createBuffered(long capacity) {
    if (capacity < 1 || capacity > 1000) throw new IllegalArgumentException("capacity is 1 to 1000");
    return keep(new BufferedSink((int) capacity));
  }

  public List<String> flush(String sink) {
    if (!(find(sink) instanceof BufferedSink buffered))
      throw new IllegalArgumentException("only a buffered sink holds lines");
    return buffered.drain();
  }
}
