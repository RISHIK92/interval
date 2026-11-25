#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>

// One way out. Each kind formats a message its own way and has its own price.
class Channel {
 public:
  virtual ~Channel() = default;

  std::string deliver(const std::string& message) {
    spent += price();
    return format(message);
  }

  int64_t spent = 0;

 protected:
  virtual int64_t price() const = 0;
  virtual std::string format(const std::string& message) const = 0;
};

class EmailChannel : public Channel {
 protected:
  int64_t price() const override { return 1; }
  std::string format(const std::string& message) const override { return "Subject: " + message; }
};

class SmsChannel : public Channel {
 protected:
  int64_t price() const override { return 5; }
  std::string format(const std::string& message) const override {
    return message.size() <= 20 ? message : message.substr(0, 17) + "...";
  }
};

class PagerChannel : public Channel {
 protected:
  int64_t price() const override { return 25; }
  std::string format(const std::string& message) const override {
    std::string out = message;
    for (char& c : out)
      if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    return out + "!";
  }
};

class WebhookChannel : public Channel {
 public:
  explicit WebhookChannel(std::string url) : url_(std::move(url)) {}

 protected:
  int64_t price() const override { return 2; }
  std::string format(const std::string& message) const override { return "POST " + url_ + " " + message; }

 private:
  std::string url_;
};

class AlertDispatcher {
 public:
  AlertDispatcher() {}

  void addChannel(std::string name, std::string kind) {
    if (kind == "email") add(name, std::make_unique<EmailChannel>());
    else if (kind == "sms") add(name, std::make_unique<SmsChannel>());
    else if (kind == "pager") add(name, std::make_unique<PagerChannel>());
    else throw std::invalid_argument("unknown kind");
  }

  std::string send(std::string channel, std::string message) { return find(channel).deliver(message); }

  int64_t cost(std::string channel) { return find(channel).spent; }

  // The extension round: a new kind, added without touching the others.
  void addWebhook(std::string name, std::string url) {
    const std::string scheme = "https://";
    if (url.rfind(scheme, 0) != 0 || url.size() <= scheme.size())
      throw std::invalid_argument("a webhook needs an https:// url");
    add(name, std::make_unique<WebhookChannel>(url));
  }

 private:
  void add(const std::string& name, std::unique_ptr<Channel> channel) {
    if (name.empty() || channels_.count(name) > 0)
      throw std::invalid_argument("a channel needs a new, non-empty name");
    channels_[name] = std::move(channel);
  }

  Channel& find(const std::string& name) {
    auto it = channels_.find(name);
    if (it == channels_.end()) throw std::invalid_argument("no such channel");
    return *it->second;
  }

  std::map<std::string, std::unique_ptr<Channel>> channels_;
};
