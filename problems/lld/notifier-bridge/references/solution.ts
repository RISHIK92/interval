const MIN_LIMIT = 10;
const MAX_LIMIT = 10000;

// The implementor side of the bridge: how a channel marks a heading, breaks a line, and
// how long a message it carries. Channels know nothing about kinds.
abstract class Channel {
  limit: number;
  sent = 0;

  constructor(limit: number) {
    this.limit = limit;
  }

  abstract heading(text: string): string;
  abstract lineBreak(): string;
}

class Email extends Channel {
  heading(text: string): string {
    return `Subject: ${text}`;
  }
  lineBreak(): string {
    return "\n";
  }
}

class Chat extends Channel {
  heading(text: string): string {
    return `*${text}*`;
  }
  lineBreak(): string {
    return "\n";
  }
}

class Sms extends Channel {
  heading(text: string): string {
    return text;
  }
  lineBreak(): string {
    return " | ";
  }
}

// The extension's channel.
class Push extends Channel {
  heading(text: string): string {
    return text;
  }
  lineBreak(): string {
    return " - ";
  }
}

// The abstraction side: a kind lays its message out using only what a channel offers, so
// any kind works with any channel, and a new channel works with every kind it never heard
// of.
abstract class Message {
  protected readonly channel: Channel;

  constructor(channel: Channel) {
    this.channel = channel;
  }

  abstract layout(subject: string, body: string): string;

  // Over the channel's limit, the text is cut and ends in "...".
  fit(text: string): string {
    const limit = this.channel.limit;
    return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
  }

  render(subject: string, body: string): string {
    return this.fit(this.layout(subject, body));
  }
}

class Alert extends Message {
  layout(subject: string, body: string): string {
    const c = this.channel;
    return c.heading(`ALERT: ${subject}`) + c.lineBreak() + body;
  }
}

class Digest extends Message {
  layout(subject: string, body: string): string {
    const c = this.channel;
    const items = body
      .split(";")
      .map((item) => item.replace(/^ +| +$/g, ""))
      .filter((item) => item !== "");
    return (
      c.heading(`Digest: ${subject}`) +
      items.map((item) => `${c.lineBreak()}- ${item}`).join("")
    );
  }
}

class Receipt extends Message {
  layout(subject: string, body: string): string {
    const c = this.channel;
    return (
      c.heading(`Receipt: ${subject}`) +
      c.lineBreak() +
      body +
      c.lineBreak() +
      "Keep this for your records."
    );
  }

  // A receipt is a record: cutting it short would lose what it is for.
  override fit(text: string): string {
    if (text.length > this.channel.limit)
      throw new RangeError("a receipt never gets cut short");
    return text;
  }
}

type Kind = new (channel: Channel) => Message;

const KINDS = new Map<string, Kind>([
  ["alert", Alert],
  ["digest", Digest],
  ["receipt", Receipt],
]);

export class Notifier {
  private readonly channels = new Map<string, Channel>([
    ["email", new Email(2000)],
    ["chat", new Chat(500)],
    ["sms", new Sms(160)],
  ]);

  send(kind: string, channel: string, subject: string, body: string): string {
    const found = KINDS.get(kind);
    if (found === undefined) throw new RangeError("unknown kind");
    const through = this.channel(channel);
    if (subject === "" || body === "") throw new RangeError("empty");
    const text = new found(through).render(subject, body);
    through.sent += 1;
    return text;
  }

  sent(channel: string): number {
    return this.channel(channel).sent;
  }

  channelLimit(channel: string, maxChars: number): void {
    const through = this.channel(channel);
    if (maxChars < MIN_LIMIT || maxChars > MAX_LIMIT)
      throw new RangeError("a limit is 10 to 10000");
    through.limit = maxChars;
  }

  // The extension round: a fourth channel, and no kind changes.
  addPush(): boolean {
    if (this.channels.has("push")) return false;
    this.channels.set("push", new Push(100));
    return true;
  }

  private channel(name: string): Channel {
    const found = this.channels.get(name);
    if (found === undefined) throw new RangeError("unknown channel");
    return found;
  }
}
