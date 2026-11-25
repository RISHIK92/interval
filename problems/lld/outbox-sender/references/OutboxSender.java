import java.util.*;
import java.util.function.Supplier;

public class OutboxSender {
  // The abstraction the sender depends on. A transport delivers one message and returns its
  // receipt, or null when the send failed; how it delivers is its own business.
  private abstract static class Transport {
    private long failures = 0;

    String send(String id, String payload) {
      if (failures > 0) {
        failures -= 1;
        return null;
      }
      return deliver(id, payload);
    }

    void planFailures(long n) {
      failures = n;
    }

    abstract String deliver(String id, String payload);
  }

  private static final class Http extends Transport {
    String deliver(String id, String payload) {
      return "POST " + id + " " + payload;
    }
  }

  private static final class Queue extends Transport {
    String deliver(String id, String payload) {
      return "PUBLISH " + id + " " + payload;
    }
  }

  private static final class Email extends Transport {
    String deliver(String id, String payload) {
      return "MAIL " + id + " " + payload;
    }
  }

  private static final Map<String, Supplier<Transport>> TRANSPORTS =
      Map.of("http", Http::new, "queue", Queue::new, "email", Email::new);

  private static Transport transportNamed(String name) {
    Supplier<Transport> made = TRANSPORTS.get(name);
    if (made == null) throw new IllegalArgumentException("unknown transport");
    return made.get();
  }

  private static void given(String value) {
    if (value.isEmpty()) throw new IllegalArgumentException("empty");
  }

  private static final class Message {
    final String id;
    final String payload;
    long failed = 0;

    Message(String id, String payload) {
      this.id = id;
      this.payload = payload;
    }
  }

  // Business code only ever writes to the outbox. Which transport delivers is chosen by
  // name from a registry and can be replaced while messages wait, without the outbox changing.
  private String name;
  private Transport transport;
  private List<Message> queued = new ArrayList<>();
  private final Set<String> seen = new HashSet<>();
  private Long limit = null;
  private final List<String> dead = new ArrayList<>();

  public OutboxSender(String transport) {
    this.transport = transportNamed(transport);
    this.name = transport;
  }

  public boolean enqueue(String id, String payload) {
    given(id);
    given(payload);
    if (!seen.add(id)) return false;
    queued.add(new Message(id, payload));
    return true;
  }

  public List<String> flush() {
    List<String> receipts = new ArrayList<>();
    List<Message> waiting = new ArrayList<>();
    for (Message message : queued) {
      String receipt = transport.send(message.id, message.payload);
      if (receipt != null) {
        receipts.add(receipt);
        continue;
      }
      message.failed += 1;
      if (limit != null && message.failed >= limit) dead.add(message.id);
      else waiting.add(message);
    }
    queued = waiting;
    return receipts;
  }

  public void failNext(long n) {
    if (n < 0) throw new IllegalArgumentException("negative count");
    transport.planFailures(n);
  }

  public void swapTransport(String transport) {
    if (transport.equals(name)) throw new IllegalArgumentException("already in use");
    this.transport = transportNamed(transport);
    this.name = transport;
  }

  public long pending() {
    return queued.size();
  }

  // The extension round: a limit on retries, and somewhere for the hopeless to go.
  public void maxAttempts(long n) {
    if (n < 1) throw new IllegalArgumentException("at least one attempt");
    limit = n;
  }

  public List<String> deadLetters() {
    return new ArrayList<>(dead);
  }
}
