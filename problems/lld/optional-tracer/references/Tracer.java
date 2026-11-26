import java.util.*;

// Samples one trace in every sampleEvery. The tracer checks arguments the same way for
// every trace, then hands the call to the trace, recording or not.
public class Tracer {
  private static final long MAX_SAMPLE_EVERY = 1000;

  private interface Trace {
    long span(String name);

    boolean endSpan(long spanId);

    List<String> recorded();

    // The trace that records from now on: itself if it already does.
    Trace sampled();
  }

  // A sampled trace: spans get ids from 1, and each one is recorded when it ends.
  private static final class RecordingTrace implements Trace {
    private final Map<Long, String> open = new HashMap<>();
    private long started = 0;
    private final List<String> ended = new ArrayList<>();

    public long span(String name) {
      started += 1;
      open.put(started, name);
      return started;
    }

    public boolean endSpan(long spanId) {
      String name = open.remove(spanId);
      if (name == null) return false;
      ended.add(spanId + " " + name);
      return true;
    }

    public List<String> recorded() {
      return new ArrayList<>(ended);
    }

    public Trace sampled() {
      return this;
    }
  }

  // The null object: the same methods as a recording trace, and they never refuse and
  // record nothing, so callers never check whether a trace is sampled.
  private static final class NoopTrace implements Trace {
    public long span(String name) {
      return 0;
    }

    public boolean endSpan(long spanId) {
      return true;
    }

    public List<String> recorded() {
      return new ArrayList<>();
    }

    public Trace sampled() {
      return new RecordingTrace();
    }
  }

  private final long every;
  private final Map<String, Trace> traces = new HashMap<>();

  public Tracer(long sampleEvery) {
    if (sampleEvery < 1 || sampleEvery > MAX_SAMPLE_EVERY)
      throw new IllegalArgumentException("bad sampling rate");
    this.every = sampleEvery;
  }

  public String startTrace(String name) {
    given(name);
    long started = traces.size();
    String trace = name + "#" + (started + 1);
    traces.put(trace, started % every == 0 ? new RecordingTrace() : new NoopTrace());
    return trace;
  }

  public long span(String trace, String name) {
    Trace found = trace(trace);
    given(name);
    return found.span(name);
  }

  public boolean endSpan(String trace, long spanId) {
    return trace(trace).endSpan(spanId);
  }

  public List<String> recorded(String trace) {
    return trace(trace).recorded();
  }

  // The extension round: sampling a trace that wasn't.
  public void forceSample(String trace) {
    traces.put(trace, trace(trace).sampled());
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty name");
  }

  private Trace trace(String trace) {
    Trace found = traces.get(trace);
    if (found == null) throw new IllegalArgumentException("unknown trace");
    return found;
  }
}
