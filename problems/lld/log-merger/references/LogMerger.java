import java.util.*;

public class LogMerger {
  private static final long EARLIEST = 0;

  private static final class Line {
    final long ts;
    final String text;

    Line(long ts, String text) {
      this.ts = ts;
      this.text = text;
    }
  }

  private static final class Stream {
    final String name;
    final List<Line> lines = new ArrayList<>();
    int head = 0; // the first line not yet returned or passed

    Stream(String name) {
      this.name = name;
    }
  }

  // Whether (ts, name) comes before (atTs, atName): time first, then stream name.
  private static boolean before(long ts, String name, long atTs, String atName) {
    return ts != atTs ? ts < atTs : name.compareTo(atName) < 0;
  }

  // An iterator over many time-ordered streams at once. Its position is the (time,
  // stream) of the last line it returned or skipped to; each stream keeps its own head, so
  // lines added later slot in without rebuilding anything.
  private final TreeMap<String, Stream> streams = new TreeMap<>();
  private final Set<String> hidden = new HashSet<>();
  private long atTs = EARLIEST;
  private String atName = "";

  public LogMerger() {}

  // The stream's first line at or after the position. Lines behind it (skipped, or passed
  // while the stream was hidden) are dropped for good.
  private Line first(Stream stream) {
    for (int i = stream.head; i < stream.lines.size(); i++) {
      Line line = stream.lines.get(i);
      if (!before(line.ts, stream.name, atTs, atName)) {
        stream.head = i;
        return line;
      }
    }
    stream.head = stream.lines.size();
    return null;
  }

  private List<Stream> visible() {
    List<Stream> out = new ArrayList<>();
    for (Stream stream : streams.values()) if (!hidden.contains(stream.name)) out.add(stream);
    return out;
  }

  private Stream peek() {
    Stream best = null;
    for (Stream stream : visible()) {
      Line line = first(stream);
      if (line != null && (best == null || line.ts < best.lines.get(best.head).ts)) best = stream;
    }
    return best;
  }

  public boolean addLine(String stream, long ts, String line) {
    if (stream.isEmpty() || line.isEmpty() || ts < EARLIEST)
      throw new IllegalArgumentException("an empty name or line, or a negative time");
    Stream found = streams.get(stream);
    if ((found != null && ts < found.lines.get(found.lines.size() - 1).ts) || before(ts, stream, atTs, atName))
      return false;
    streams.computeIfAbsent(stream, Stream::new).lines.add(new Line(ts, line));
    return true;
  }

  public boolean hasNext() {
    return peek() != null;
  }

  public String next() {
    Stream best = peek();
    if (best == null) throw new NoSuchElementException("no more lines");
    Line line = best.lines.get(best.head++);
    atTs = line.ts;
    atName = best.name;
    return line.ts + " " + best.name + " " + line.text;
  }

  public long skipUntil(long ts) {
    if (ts < EARLIEST) throw new IllegalArgumentException("a negative time");
    long skipped = 0;
    for (Stream stream : visible()) {
      if (first(stream) == null) continue;
      for (int i = stream.head; i < stream.lines.size(); i++) if (stream.lines.get(i).ts < ts) skipped++;
    }
    // Moving the position is the skip: every line behind it is dropped when reached.
    if (before(atTs, atName, ts, "")) {
      atTs = ts;
      atName = "";
    }
    return skipped;
  }

  // The extension round: a hidden stream is passed over, not held back.
  public void filterStream(String stream, boolean on) {
    if (stream.isEmpty()) throw new IllegalArgumentException("an empty stream");
    if (on) hidden.add(stream);
    else hidden.remove(stream);
  }
}
