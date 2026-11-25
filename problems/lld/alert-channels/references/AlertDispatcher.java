import java.util.*;

public class AlertDispatcher {
  // One way out. Each kind formats a message its own way and has its own price.
  private abstract static class Channel {
    long spent = 0;

    abstract long price();

    abstract String format(String message);

    String deliver(String message) {
      spent += price();
      return format(message);
    }
  }

  private static final class EmailChannel extends Channel {
    long price() { return 1; }

    String format(String message) { return "Subject: " + message; }
  }

  private static final class SmsChannel extends Channel {
    long price() { return 5; }

    String format(String message) {
      return message.length() <= 20 ? message : message.substring(0, 17) + "...";
    }
  }

  private static final class PagerChannel extends Channel {
    long price() { return 25; }

    String format(String message) { return message.toUpperCase(Locale.ROOT) + "!"; }
  }

  private static final class WebhookChannel extends Channel {
    private final String url;

    WebhookChannel(String url) { this.url = url; }

    long price() { return 2; }

    String format(String message) { return "POST " + url + " " + message; }
  }

  private final Map<String, Channel> channels = new HashMap<>();

  private void add(String name, Channel channel) {
    if (name.isEmpty() || channels.containsKey(name))
      throw new IllegalArgumentException("a channel needs a new, non-empty name");
    channels.put(name, channel);
  }

  private Channel channel(String name) {
    Channel channel = channels.get(name);
    if (channel == null) throw new IllegalArgumentException("no such channel");
    return channel;
  }

  public void addChannel(String name, String kind) {
    Channel channel = switch (kind) {
      case "email" -> new EmailChannel();
      case "sms" -> new SmsChannel();
      case "pager" -> new PagerChannel();
      default -> throw new IllegalArgumentException("unknown kind");
    };
    add(name, channel);
  }

  public String send(String channel, String message) {
    return channel(channel).deliver(message);
  }

  public long cost(String channel) {
    return channel(channel).spent;
  }

  // The extension round: a new kind, added without touching the others.
  public void addWebhook(String name, String url) {
    if (!url.startsWith("https://") || url.length() <= "https://".length())
      throw new IllegalArgumentException("a webhook needs an https:// url");
    add(name, new WebhookChannel(url));
  }
}
