import java.util.*;

public class SprintBoard {
  // The columns, in board order: a ticket moves only to a neighbour.
  private enum Column {
    TODO,
    DOING,
    REVIEW,
    DONE;

    String label() {
      return name().toLowerCase();
    }

    static Column named(String name) {
      for (Column c : values()) if (c.label().equals(name)) return c;
      throw new IllegalArgumentException("no such column");
    }
  }

  private static final class Ticket {
    final long points;
    Column column = Column.TODO;
    String reason;

    Ticket(long points) {
      this.points = points;
    }
  }

  private final long limit;
  // Insertion order is ticket-number order.
  private final Map<String, Ticket> tickets = new LinkedHashMap<>();

  public SprintBoard(long wipLimit) {
    if (wipLimit < 1 || wipLimit > 100) throw new IllegalArgumentException("wipLimit must be within 1-100");
    limit = wipLimit;
  }

  private Ticket ticket(String ticket) {
    Ticket t = tickets.get(ticket);
    if (t == null) throw new NoSuchElementException("no such ticket");
    return t;
  }

  private long countIn(Column column) {
    return tickets.values().stream().filter(t -> t.column == column).count();
  }

  public String add(String title, long points) {
    if (title.isEmpty() || points < 1 || points > 100)
      throw new IllegalArgumentException("a ticket needs a title and 1-100 points");
    String ticket = "T-" + (tickets.size() + 1);
    tickets.put(ticket, new Ticket(points));
    return ticket;
  }

  public boolean move(String ticket, String column) {
    Ticket t = ticket(ticket);
    Column to = Column.named(column);
    if (Math.abs(to.ordinal() - t.column.ordinal()) != 1 || t.reason != null) return false;
    if (to == Column.DOING && countIn(Column.DOING) >= limit) return false;
    t.column = to;
    return true;
  }

  public String column(String ticket) {
    return ticket(ticket).column.label();
  }

  public long velocity() {
    long sum = 0;
    for (Ticket t : tickets.values()) if (t.column == Column.DONE) sum += t.points;
    return sum;
  }

  // The extension round.
  public void block(String ticket, String reason) {
    Ticket t = ticket(ticket);
    if (reason.isEmpty()) throw new IllegalArgumentException("a block needs a reason");
    t.reason = reason;
  }

  public void unblock(String ticket) {
    ticket(ticket).reason = null;
  }

  public List<String> blocked() {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, Ticket> e : tickets.entrySet())
      if (e.getValue().reason != null) out.add(e.getKey() + ": " + e.getValue().reason);
    return out;
  }
}
