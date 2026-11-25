// One way out. Each kind formats a message its own way and has its own price.
abstract class Channel {
  spent = 0;

  protected abstract price(): number;
  protected abstract format(message: string): string;

  deliver(message: string): string {
    this.spent += this.price();
    return this.format(message);
  }
}

class EmailChannel extends Channel {
  protected price(): number {
    return 1;
  }

  protected format(message: string): string {
    return `Subject: ${message}`;
  }
}

class SmsChannel extends Channel {
  protected price(): number {
    return 5;
  }

  protected format(message: string): string {
    return message.length <= 20 ? message : `${message.slice(0, 17)}...`;
  }
}

class PagerChannel extends Channel {
  protected price(): number {
    return 25;
  }

  protected format(message: string): string {
    return `${message.toUpperCase()}!`;
  }
}

class WebhookChannel extends Channel {
  private readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  protected price(): number {
    return 2;
  }

  protected format(message: string): string {
    return `POST ${this.url} ${message}`;
  }
}

const KINDS = new Map<string, () => Channel>([
  ["email", () => new EmailChannel()],
  ["sms", () => new SmsChannel()],
  ["pager", () => new PagerChannel()],
]);

export class AlertDispatcher {
  private readonly channels = new Map<string, Channel>();

  private add(name: string, channel: Channel): void {
    if (name === "" || this.channels.has(name))
      throw new RangeError("a channel needs a new, non-empty name");
    this.channels.set(name, channel);
  }

  private channel(name: string): Channel {
    const channel = this.channels.get(name);
    if (channel === undefined) throw new RangeError("no such channel");
    return channel;
  }

  addChannel(name: string, kind: string): void {
    const make = KINDS.get(kind);
    if (make === undefined) throw new RangeError("unknown kind");
    this.add(name, make());
  }

  send(channel: string, message: string): string {
    return this.channel(channel).deliver(message);
  }

  cost(channel: string): number {
    return this.channel(channel).spent;
  }

  // The extension round: a new kind, added without touching the others.
  addWebhook(name: string, url: string): void {
    if (!url.startsWith("https://") || url.length <= "https://".length)
      throw new RangeError("a webhook needs an https:// url");
    this.add(name, new WebhookChannel(url));
  }
}
