import java.util.*;
import java.util.function.Function;

public class Notifier {
  private static final long MIN_LIMIT = 10;
  private static final long MAX_LIMIT = 10000;

  // The implementor side of the bridge: how a channel marks a heading, breaks a line, and
  // how long a message it carries. Channels know nothing about kinds.
  private abstract static class Channel {
    long limit;
    long sent = 0;

    Channel(long limit) {
      this.limit = limit;
    }

    abstract String heading(String text);

    abstract String lineBreak();
  }

  private static final class Email extends Channel {
    Email(long limit) {
      super(limit);
    }

    String heading(String text) {
      return "Subject: " + text;
    }

    String lineBreak() {
      return "\n";
    }
  }

  private static final class Chat extends Channel {
    Chat(long limit) {
      super(limit);
    }

    String heading(String text) {
      return "*" + text + "*";
    }

    String lineBreak() {
      return "\n";
    }
  }

  private static final class Sms extends Channel {
    Sms(long limit) {
      super(limit);
    }

    String heading(String text) {
      return text;
    }

    String lineBreak() {
      return " | ";
    }
  }

  // The extension's channel.
  private static final class Push extends Channel {
    Push(long limit) {
      super(limit);
    }

    String heading(String text) {
      return text;
    }

    String lineBreak() {
      return " - ";
    }
  }

  // The abstraction side: a kind lays its message out using only what a channel offers,
  // so any kind works with any channel, and a new channel works with every kind it never
  // heard of.
  private abstract static class Message {
    protected final Channel channel;

    Message(Channel channel) {
      this.channel = channel;
    }

    abstract String layout(String subject, String body);

    // Over the channel's limit, the text is cut and ends in "...".
    String fit(String text) {
      if (text.length() <= channel.limit) return text;
      return text.substring(0, (int) channel.limit - 3) + "...";
    }

    String render(String subject, String body) {
      return fit(layout(subject, body));
    }
  }

  private static final class Alert extends Message {
    Alert(Channel channel) {
      super(channel);
    }

    String layout(String subject, String body) {
      return channel.heading("ALERT: " + subject) + channel.lineBreak() + body;
    }
  }

  private static final class Digest extends Message {
    Digest(Channel channel) {
      super(channel);
    }

    String layout(String subject, String body) {
      StringBuilder out = new StringBuilder(channel.heading("Digest: " + subject));
      for (String item : body.split(";", -1)) {
        String trimmed = item.replaceAll("^ +| +$", "");
        if (!trimmed.isEmpty()) out.append(channel.lineBreak()).append("- ").append(trimmed);
      }
      return out.toString();
    }
  }

  private static final class Receipt extends Message {
    Receipt(Channel channel) {
      super(channel);
    }

    String layout(String subject, String body) {
      return channel.heading("Receipt: " + subject)
          + channel.lineBreak()
          + body
          + channel.lineBreak()
          + "Keep this for your records.";
    }

    // A receipt is a record: cutting it short would lose what it is for.
    @Override
    String fit(String text) {
      if (text.length() > channel.limit)
        throw new IllegalArgumentException("a receipt never gets cut short");
      return text;
    }
  }

  private static final Map<String, Function<Channel, Message>> KINDS =
      Map.of("alert", Alert::new, "digest", Digest::new, "receipt", Receipt::new);

  private final Map<String, Channel> channels = new HashMap<>();

  public Notifier() {
    channels.put("email", new Email(2000));
    channels.put("chat", new Chat(500));
    channels.put("sms", new Sms(160));
  }

  public String send(String kind, String channel, String subject, String body) {
    Function<Channel, Message> found = KINDS.get(kind);
    if (found == null) throw new IllegalArgumentException("unknown kind");
    Channel through = channel(channel);
    if (subject.isEmpty() || body.isEmpty()) throw new IllegalArgumentException("empty");
    String text = found.apply(through).render(subject, body);
    through.sent += 1;
    return text;
  }

  public long sent(String channel) {
    return channel(channel).sent;
  }

  public void channelLimit(String channel, long maxChars) {
    Channel through = channel(channel);
    if (maxChars < MIN_LIMIT || maxChars > MAX_LIMIT)
      throw new IllegalArgumentException("a limit is 10 to 10000");
    through.limit = maxChars;
  }

  // The extension round: a fourth channel, and no kind changes.
  public boolean addPush() {
    if (channels.containsKey("push")) return false;
    channels.put("push", new Push(100));
    return true;
  }

  private Channel channel(String name) {
    Channel found = channels.get(name);
    if (found == null) throw new IllegalArgumentException("unknown channel");
    return found;
  }
}
