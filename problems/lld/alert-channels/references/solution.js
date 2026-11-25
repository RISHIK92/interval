"use strict";

// One way out. Each kind formats a message its own way and has its own price.
class Channel {
  spent = 0;

  deliver(message) {
    this.spent += this.price();
    return this.format(message);
  }
}

class EmailChannel extends Channel {
  price() {
    return 1;
  }

  format(message) {
    return `Subject: ${message}`;
  }
}

class SmsChannel extends Channel {
  price() {
    return 5;
  }

  format(message) {
    return message.length <= 20 ? message : `${message.slice(0, 17)}...`;
  }
}

class PagerChannel extends Channel {
  price() {
    return 25;
  }

  format(message) {
    return `${message.toUpperCase()}!`;
  }
}

class WebhookChannel extends Channel {
  constructor(url) {
    super();
    this.url = url;
  }

  price() {
    return 2;
  }

  format(message) {
    return `POST ${this.url} ${message}`;
  }
}

const KINDS = { email: EmailChannel, sms: SmsChannel, pager: PagerChannel };

class AlertDispatcher {
  #channels = new Map();

  #add(name, channel) {
    if (name === "" || this.#channels.has(name))
      throw new RangeError("a channel needs a new, non-empty name");
    this.#channels.set(name, channel);
  }

  #channel(name) {
    const channel = this.#channels.get(name);
    if (channel === undefined) throw new RangeError("no such channel");
    return channel;
  }

  addChannel(name, kind) {
    if (!Object.hasOwn(KINDS, kind)) throw new RangeError("unknown kind");
    this.#add(name, new KINDS[kind]());
  }

  send(channel, message) {
    return this.#channel(channel).deliver(message);
  }

  cost(channel) {
    return this.#channel(channel).spent;
  }

  // The extension round: a new kind, added without touching the others.
  addWebhook(name, url) {
    if (!url.startsWith("https://") || url.length <= "https://".length)
      throw new RangeError("a webhook needs an https:// url");
    this.#add(name, new WebhookChannel(url));
  }
}

module.exports = { AlertDispatcher };
