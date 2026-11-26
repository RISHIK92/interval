public class Rollout {
  private static final double ADVANCE_BELOW = 1.0;
  private static final double ABORT_ABOVE = 5.0;
  private static final double MAX_RATE = 100.0;

  // One state of the rollout. Each move returns the next state, or null when this state
  // doesn't allow it, so every state lists only its own moves.
  private static class State {
    final String name;
    final long percent;

    State(String name, long percent) {
      this.name = name;
      this.percent = percent;
    }

    State begin() {
      return null;
    }

    State advance() {
      return null;
    }

    State pause() {
      return null;
    }

    State resume() {
      return null;
    }

    State abort() {
      return null;
    }
  }

  private static final class Paused extends State {
    private final State was;

    Paused(State was) {
      super("paused", was.percent);
      this.was = was;
    }

    @Override
    State resume() {
      return was;
    }
  }

  // Canary and rolling share their moves: on, pause and abort.
  private static final class Moving extends State {
    private final State after;

    Moving(String name, long percent, State after) {
      super(name, percent);
      this.after = after;
    }

    @Override
    State advance() {
      return after;
    }

    @Override
    State pause() {
      return new Paused(this);
    }

    @Override
    State abort() {
      return new State("rolled-back", 0);
    }
  }

  private static final class Pending extends State {
    Pending() {
      super("pending", 0);
    }

    @Override
    State begin() {
      return new Moving("canary", 10, new Moving("rolling", 50, new State("done", 100)));
    }
  }

  private final String service;
  private String version = "";
  private State state = new Pending();

  public Rollout(String service) {
    if (service.isEmpty()) throw new IllegalArgumentException("an empty service");
    this.service = service;
  }

  private boolean move(State to) {
    if (to == null) return false;
    state = to;
    return true;
  }

  public boolean begin(String version) {
    if (version.isEmpty()) throw new IllegalArgumentException("an empty version");
    State to = state.begin();
    if (to != null) this.version = version;
    return move(to);
  }

  public boolean advance() {
    return move(state.advance());
  }

  public boolean pause() {
    return move(state.pause());
  }

  public boolean resume() {
    return move(state.resume());
  }

  public boolean abort() {
    return move(state.abort());
  }

  public String status() {
    if (version.isEmpty()) return service + " " + state.name;
    return service + " " + state.name + " " + version + " " + state.percent + "%";
  }

  // The extension round: the error rate decides the move.
  public boolean autoAdvance(double errorRate) {
    if (errorRate < 0 || errorRate > MAX_RATE)
      throw new IllegalArgumentException("an error rate from 0 to 100");
    if (errorRate < ADVANCE_BELOW) return advance();
    if (errorRate > ABORT_ABOVE) return abort();
    return false;
  }
}
