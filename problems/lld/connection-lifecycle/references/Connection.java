import java.util.*;

public class Connection {
  private enum State {
    IDLE, OPEN, CLOSED, FAILED;

    String label() {
      return name().toLowerCase(Locale.ROOT);
    }
  }

  private enum Action { CONNECT, DISCONNECT, FAIL, RECONNECT }

  // Every legal move: action -> (from -> to). Anything else is refused.
  private static final Map<Action, Map<State, State>> MOVES = Map.of(
      Action.CONNECT, Map.of(State.IDLE, State.OPEN),
      Action.DISCONNECT, Map.of(State.OPEN, State.CLOSED),
      Action.FAIL, Map.of(State.IDLE, State.FAILED, State.OPEN, State.FAILED),
      Action.RECONNECT, Map.of(State.FAILED, State.OPEN));

  private final String host;
  private State current = State.IDLE;
  private long reopened = 0;

  public Connection(String host) {
    if (host.isEmpty()) throw new IllegalArgumentException("a connection needs a host");
    this.host = host;
  }

  private boolean move(Action action) {
    State to = MOVES.get(action).get(current);
    if (to == null) return false;
    current = to;
    return true;
  }

  public boolean connect() {
    return move(Action.CONNECT);
  }

  public boolean disconnect() {
    return move(Action.DISCONNECT);
  }

  public void fail(String reason) {
    if (reason.isEmpty()) throw new IllegalArgumentException("a failure needs a reason");
    move(Action.FAIL);
  }

  public String state() {
    return current.label();
  }

  // The extension round.
  public boolean reconnect() {
    boolean moved = move(Action.RECONNECT);
    if (moved) reopened++;
    return moved;
  }

  public long attempts() {
    return reopened;
  }
}
