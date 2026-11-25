import java.util.*;
import java.util.function.BiFunction;

// A handler wrapped in layers, the last one wrapped outermost.
public class HandlerStack {
  private static final int OK = 200;
  private static final int UNAUTHORIZED = 401;
  private static final String BEARER = "Bearer ";

  // The innermost handler: it serves every request it's given.
  private static class Handler {
    final String name;

    Handler(String name) {
      this.name = name;
    }

    int serve(String path, String token, List<String> trace) {
      trace.add(name + " " + path);
      return OK;
    }
  }

  // A decorator: it looks like a handler, holds the one it wraps, and adds its own lines
  // around the call. Subclasses change only the part they're about.
  private static class Layer extends Handler {
    final Handler inner;

    Layer(String name, Handler inner) {
      super(name);
      this.inner = inner;
    }

    @Override
    int serve(String path, String token, List<String> trace) {
      trace.add(entered());
      int status = inside(path, token, trace);
      trace.add(left(status));
      return status;
    }

    String entered() {
      return "enter " + name;
    }

    int inside(String path, String token, List<String> trace) {
      return inner.serve(path, token, trace);
    }

    String left(int status) {
      return "leave " + name;
    }
  }

  private static final class Auth extends Layer {
    Auth(String name, Handler inner) {
      super(name, inner);
    }

    @Override
    int inside(String path, String token, List<String> trace) {
      if (!token.startsWith(BEARER) || token.length() == BEARER.length()) {
        trace.add("deny");
        return UNAUTHORIZED;
      }
      return super.inside(path, token, trace);
    }
  }

  private static final class RequestId extends Layer {
    private long seen = 0;

    RequestId(String name, Handler inner) {
      super(name, inner);
    }

    @Override
    String entered() {
      seen += 1;
      return super.entered() + " " + seen;
    }
  }

  private static final class Compress extends Layer {
    Compress(String name, Handler inner) {
      super(name, inner);
    }

    @Override
    String left(int status) {
      return status == OK ? super.left(status) + " gzip" : super.left(status);
    }
  }

  private static final Map<String, BiFunction<String, Handler, Layer>> KINDS =
      Map.of("auth", Auth::new, "request-id", RequestId::new, "compress", Compress::new);

  private Handler top;
  private final Deque<Layer> wrapped = new ArrayDeque<>();

  public HandlerStack(String handler) {
    if (handler.isEmpty()) throw new IllegalArgumentException("empty handler");
    top = new Handler(handler);
  }

  public void wrap(String layer) {
    BiFunction<String, Handler, Layer> kind = KINDS.get(layer);
    if (kind == null) throw new IllegalArgumentException("unknown layer");
    Layer outer = kind.apply(layer, top);
    wrapped.push(outer);
    top = outer;
  }

  public List<String> handle(String path, String token) {
    if (path.isEmpty() || token.isEmpty()) throw new IllegalArgumentException("empty path or token");
    List<String> trace = new ArrayList<>();
    int status = top.serve(path, token, trace);
    trace.add(String.valueOf(status));
    return trace;
  }

  public List<String> layers() {
    List<String> names = new ArrayList<>();
    for (Layer layer : wrapped) names.add(layer.name);
    return names;
  }

  // The extension round: peeling the outermost layer off again.
  public boolean unwrap() {
    Layer outer = wrapped.poll();
    if (outer == null) return false;
    top = outer.inner;
    return true;
  }
}
