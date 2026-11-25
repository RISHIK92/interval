#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>

// The implementor side of the bridge: how a channel marks a heading, breaks a line, and
// how long a message it carries. Channels know nothing about kinds.
class Channel {
 public:
  explicit Channel(int64_t limit) : limit(limit) {}
  virtual ~Channel() = default;
  virtual std::string heading(const std::string& text) const = 0;
  virtual std::string lineBreak() const = 0;

  int64_t limit;
  int64_t sent = 0;
};

class EmailChannel : public Channel {
 public:
  using Channel::Channel;
  std::string heading(const std::string& text) const override { return "Subject: " + text; }
  std::string lineBreak() const override { return "\n"; }
};

class ChatChannel : public Channel {
 public:
  using Channel::Channel;
  std::string heading(const std::string& text) const override { return "*" + text + "*"; }
  std::string lineBreak() const override { return "\n"; }
};

class SmsChannel : public Channel {
 public:
  using Channel::Channel;
  std::string heading(const std::string& text) const override { return text; }
  std::string lineBreak() const override { return " | "; }
};

// The extension's channel.
class PushChannel : public Channel {
 public:
  using Channel::Channel;
  std::string heading(const std::string& text) const override { return text; }
  std::string lineBreak() const override { return " - "; }
};

// The abstraction side: a kind lays its message out using only what a channel offers, so
// any kind works with any channel, and a new channel works with every kind it never heard
// of.
class Message {
 public:
  explicit Message(const Channel& channel) : channel_(channel) {}
  virtual ~Message() = default;

  std::string render(const std::string& subject, const std::string& body) const {
    return fit(layout(subject, body));
  }

 protected:
  virtual std::string layout(const std::string& subject, const std::string& body) const = 0;

  // Over the channel's limit, the text is cut and ends in "...".
  virtual std::string fit(const std::string& text) const {
    if (static_cast<int64_t>(text.size()) <= channel_.limit) return text;
    return text.substr(0, static_cast<size_t>(channel_.limit - 3)) + "...";
  }

  const Channel& channel_;
};

class AlertMessage : public Message {
 public:
  using Message::Message;

 protected:
  std::string layout(const std::string& subject, const std::string& body) const override {
    return channel_.heading("ALERT: " + subject) + channel_.lineBreak() + body;
  }
};

class DigestMessage : public Message {
 public:
  using Message::Message;

 protected:
  std::string layout(const std::string& subject, const std::string& body) const override {
    std::string out = channel_.heading("Digest: " + subject);
    size_t start = 0;
    for (size_t i = 0; i <= body.size(); i++) {
      if (i < body.size() && body[i] != ';') continue;
      size_t from = start;
      size_t to = i;
      for (; from < to && body[from] == ' '; from++) {
      }
      for (; to > from && body[to - 1] == ' '; to--) {
      }
      if (to > from) out += channel_.lineBreak() + "- " + body.substr(from, to - from);
      start = i + 1;
    }
    return out;
  }
};

class ReceiptMessage : public Message {
 public:
  using Message::Message;

 protected:
  std::string layout(const std::string& subject, const std::string& body) const override {
    return channel_.heading("Receipt: " + subject) + channel_.lineBreak() + body + channel_.lineBreak() +
           "Keep this for your records.";
  }

  // A receipt is a record: cutting it short would lose what it is for.
  std::string fit(const std::string& text) const override {
    if (static_cast<int64_t>(text.size()) > channel_.limit)
      throw std::invalid_argument("a receipt never gets cut short");
    return text;
  }
};

class Notifier {
 public:
  Notifier() {
    channels_["email"] = std::make_unique<EmailChannel>(2000);
    channels_["chat"] = std::make_unique<ChatChannel>(500);
    channels_["sms"] = std::make_unique<SmsChannel>(160);
  }

  std::string send(std::string kind, std::string channel, std::string subject, std::string body) {
    using Kind = std::function<std::unique_ptr<Message>(const Channel&)>;
    static const std::map<std::string, Kind> kinds = {
        {"alert", [](const Channel& c) { return std::make_unique<AlertMessage>(c); }},
        {"digest", [](const Channel& c) { return std::make_unique<DigestMessage>(c); }},
        {"receipt", [](const Channel& c) { return std::make_unique<ReceiptMessage>(c); }}};
    auto found = kinds.find(kind);
    if (found == kinds.end()) throw std::invalid_argument("unknown kind");
    Channel& through = find(channel);
    if (subject.empty() || body.empty()) throw std::invalid_argument("empty");
    std::string text = found->second(through)->render(subject, body);
    through.sent += 1;
    return text;
  }

  int64_t sent(std::string channel) { return find(channel).sent; }

  void channelLimit(std::string channel, int64_t maxChars) {
    Channel& through = find(channel);
    if (maxChars < kMinLimit || maxChars > kMaxLimit) throw std::invalid_argument("a limit is 10 to 10000");
    through.limit = maxChars;
  }

  // The extension round: a fourth channel, and no kind changes.
  bool addPush() {
    if (channels_.count("push")) return false;
    channels_["push"] = std::make_unique<PushChannel>(100);
    return true;
  }

 private:
  static constexpr int64_t kMinLimit = 10;
  static constexpr int64_t kMaxLimit = 10000;

  Channel& find(const std::string& name) {
    auto found = channels_.find(name);
    if (found == channels_.end()) throw std::invalid_argument("unknown channel");
    return *found->second;
  }

  std::map<std::string, std::unique_ptr<Channel>> channels_;
};
