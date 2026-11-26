import java.util.*;

public class Broker {
  private static final long MAX_POLL = 100;
  private static final int MAX_NACKS = 3;
  private static final String IN_FLIGHT = "in-flight";
  private static final String DONE = "done";
  private static final String DEAD = "dead";

  private static void checkNamed(String... names) {
    for (String name : names) if (name.isEmpty()) throw new IllegalArgumentException("an empty name or payload");
  }

  private static void checkOffset(long offset) {
    if (offset < 0) throw new IllegalArgumentException("an offset is at least 0");
  }

  // A consumer group: its members share one position in the topic. It covers the offsets
  // from `start`; each one below `next` is in `state` or waiting in `again`.
  private static final class Group {
    final String topic;
    final Set<String> consumers = new HashSet<>();
    long start;
    long next;
    final TreeSet<Long> again = new TreeSet<>(); // offsets to deliver again
    final Map<Long, String> state = new HashMap<>();
    final Map<Long, Integer> nacks = new HashMap<>();
    final List<Long> dead = new ArrayList<>();

    Group(String topic, long start) {
      this.topic = topic;
      this.start = start;
      this.next = start;
    }

    List<Long> take(long most, long end) {
      List<Long> taken = new ArrayList<>();
      for (long n = Math.min(most, again.size()); n > 0; n--) taken.add(again.pollFirst());
      // Redeliveries are always below `next`, so this keeps offset order.
      long fresh = Math.min(most - taken.size(), end - next);
      for (long i = 0; i < fresh; i++) taken.add(next + i);
      next += fresh;
      for (long offset : taken) state.put(offset, IN_FLIGHT);
      return taken;
    }

    boolean settle(long offset, boolean acked) {
      if (!IN_FLIGHT.equals(state.get(offset))) return false;
      if (acked) {
        state.put(offset, DONE);
        return true;
      }
      int count = nacks.merge(offset, 1, Integer::sum);
      if (count == MAX_NACKS) {
        state.put(offset, DEAD);
        dead.add(offset);
      } else {
        toAgain(offset);
      }
      return true;
    }

    long rewind(long offset) {
      long made = 0;
      for (long o = offset; o < next; o++) {
        String s = state.get(o);
        if (o < start || IN_FLIGHT.equals(s) || DONE.equals(s)) {
          nacks.remove(o);
          toAgain(o);
          made++;
        }
      }
      start = Math.min(start, offset);
      return made;
    }

    private void toAgain(long offset) {
      state.remove(offset);
      again.add(offset);
    }
  }

  // The mediator: publishers and consumer groups only ever talk to it, never to each other.
  private final Map<String, List<String>> topics = new HashMap<>();
  private final Map<String, Group> groups = new HashMap<>();

  public long publishMsg(String topic, String payload) {
    checkNamed(topic, payload);
    List<String> messages = topics.computeIfAbsent(topic, k -> new ArrayList<>());
    messages.add(payload);
    return messages.size() - 1;
  }

  public void subscribeGroup(String group, String topic, String consumer) {
    checkNamed(group, topic, consumer);
    Group found = groups.get(group);
    if (found == null) {
      found = new Group(topic, topics.getOrDefault(topic, List.of()).size());
      groups.put(group, found);
    } else if (!found.topic.equals(topic)) {
      throw new IllegalArgumentException("a group reads one topic");
    }
    found.consumers.add(consumer);
  }

  public List<String> poll(String group, String consumer, long max) {
    Group found = findGroup(group);
    if (!found.consumers.contains(consumer) || max < 1 || max > MAX_POLL)
      throw new IllegalArgumentException("not a member, or max outside 1 to 100");
    List<String> out = new ArrayList<>();
    for (long o : found.take(max, topics.getOrDefault(found.topic, List.of()).size())) out.add(shown(found, o));
    return out;
  }

  public boolean ack(String group, long offset) {
    Group found = findGroup(group);
    checkOffset(offset);
    return found.settle(offset, true);
  }

  public boolean nack(String group, long offset) {
    Group found = findGroup(group);
    checkOffset(offset);
    return found.settle(offset, false);
  }

  public List<String> deadLetters(String group) {
    Group found = findGroup(group);
    List<String> out = new ArrayList<>();
    for (long o : found.dead) out.add(shown(found, o));
    return out;
  }

  // The extension round: rewind a group to an earlier offset.
  public long replayFrom(String group, long offset) {
    Group found = findGroup(group);
    checkOffset(offset);
    return found.rewind(offset);
  }

  private String shown(Group group, long offset) {
    return offset + ":" + topics.get(group.topic).get((int) offset);
  }

  private Group findGroup(String group) {
    Group found = groups.get(group);
    if (found == null) throw new NoSuchElementException("no such group");
    return found;
  }
}
