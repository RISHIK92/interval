"use strict";

const MIN_LIMIT = 10;
const MAX_LIMIT = 10000;

// The implementor side of the bridge: how a channel marks a heading, breaks a line, and
// how long a message it carries. Channels know nothing about kinds. Subclasses give
// heading(text) and lineBreak().
class Channel {
  constructor(limit) {
    this.limit = limit;
    this.sent = 0;
  }
}

class Email extends Channel {
  heading(text) {
    return `Subject: ${text}`;
  }
  lineBreak() {
    return "\n";
  }
}

class Chat extends Channel {
  heading(text) {
    return `*${text}*`;
  }
  lineBreak() {
    return "\n";
  }
}

class Sms extends Channel {
  heading(text) {
    return text;
  }
  lineBreak() {
    return " | ";
  }
}

// The extension's channel.
class Push extends Channel {
  heading(text) {
    return text;
  }
  lineBreak() {
    return " - ";
  }
}

// The abstraction side: a kind lays its message out using only what a channel offers, so
// any kind works with any channel, and a new channel works with every kind it never heard
// of. Subclasses give layout(subject, body).
class Message {
  constructor(channel) {
    this.channel = channel;
  }

  // Over the channel's limit, the text is cut and ends in "...".
  fit(text) {
    const limit = this.channel.limit;
    return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
  }

  render(subject, body) {
    return this.fit(this.layout(subject, body));
  }
}

class Alert extends Message {
  layout(subject, body) {
    const c = this.channel;
    return c.heading(`ALERT: ${subject}`) + c.lineBreak() + body;
  }
}

class Digest extends Message {
  layout(subject, body) {
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
  layout(subject, body) {
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
  fit(text) {
    if (text.length > this.channel.limit)
      throw new RangeError("a receipt never gets cut short");
    return text;
  }
}

const KINDS = new Map([
  ["alert", Alert],
  ["digest", Digest],
  ["receipt", Receipt],
]);

class Notifier {
  constructor() {
    this.channels = new Map([
      ["email", new Email(2000)],
      ["chat", new Chat(500)],
      ["sms", new Sms(160)],
    ]);
  }

  send(kind, channel, subject, body) {
    const Kind = KINDS.get(kind);
    if (Kind === undefined) throw new RangeError("unknown kind");
    const through = this.channel(channel);
    if (subject === "" || body === "") throw new RangeError("empty");
    const text = new Kind(through).render(subject, body);
    through.sent += 1;
    return text;
  }

  sent(channel) {
    return this.channel(channel).sent;
  }

  channelLimit(channel, maxChars) {
    const through = this.channel(channel);
    if (maxChars < MIN_LIMIT || maxChars > MAX_LIMIT)
      throw new RangeError("a limit is 10 to 10000");
    through.limit = maxChars;
  }

  // The extension round: a fourth channel, and no kind changes.
  addPush() {
    if (this.channels.has("push")) return false;
    this.channels.set("push", new Push(100));
    return true;
  }

  channel(name) {
    const found = this.channels.get(name);
    if (found === undefined) throw new RangeError("unknown channel");
    return found;
  }
}

module.exports = { Notifier };
