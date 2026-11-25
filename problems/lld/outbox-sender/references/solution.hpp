#pragma once
#include <cstdint>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// The abstraction the sender depends on. A transport delivers one message and returns its
// receipt, or nothing when the send failed; how it delivers is its own business.
class Transport {
 public:
  virtual ~Transport() = default;

  std::optional<std::string> send(const std::string& id, const std::string& payload) {
    if (failures > 0) {
      failures -= 1;
      return std::nullopt;
    }
    return deliver(id, payload);
  }

  void planFailures(int64_t n) { failures = n; }

 protected:
  virtual std::string deliver(const std::string& id, const std::string& payload) const = 0;

 private:
  int64_t failures = 0;
};

class HttpTransport : public Transport {
 protected:
  std::string deliver(const std::string& id, const std::string& payload) const override {
    return "POST " + id + " " + payload;
  }
};

class QueueTransport : public Transport {
 protected:
  std::string deliver(const std::string& id, const std::string& payload) const override {
    return "PUBLISH " + id + " " + payload;
  }
};

class EmailTransport : public Transport {
 protected:
  std::string deliver(const std::string& id, const std::string& payload) const override {
    return "MAIL " + id + " " + payload;
  }
};

// Business code only ever writes to the outbox. Which transport delivers is chosen by
// name from a registry and can be replaced while messages wait, without the outbox changing.
class OutboxSender {
 public:
  explicit OutboxSender(std::string transport) : name_(transport), transport_(named(transport)) {}

  bool enqueue(std::string id, std::string payload) {
    given(id);
    given(payload);
    if (!seen_.insert(id).second) return false;
    queued_.push_back({id, payload, 0});
    return true;
  }

  std::vector<std::string> flush() {
    std::vector<std::string> receipts;
    std::vector<Message> waiting;
    for (auto& message : queued_) {
      auto receipt = transport_->send(message.id, message.payload);
      if (receipt) {
        receipts.push_back(*receipt);
        continue;
      }
      message.failed += 1;
      if (limit_ && message.failed >= *limit_)
        dead_.push_back(message.id);
      else
        waiting.push_back(message);
    }
    queued_ = std::move(waiting);
    return receipts;
  }

  void failNext(int64_t n) {
    if (n < 0) throw std::invalid_argument("negative count");
    transport_->planFailures(n);
  }

  void swapTransport(std::string transport) {
    if (transport == name_) throw std::invalid_argument("already in use");
    transport_ = named(transport);
    name_ = transport;
  }

  int64_t pending() { return static_cast<int64_t>(queued_.size()); }

  // The extension round: a limit on retries, and somewhere for the hopeless to go.
  void maxAttempts(int64_t n) {
    if (n < 1) throw std::invalid_argument("at least one attempt");
    limit_ = n;
  }

  std::vector<std::string> deadLetters() { return dead_; }

 private:
  struct Message {
    std::string id;
    std::string payload;
    int64_t failed;
  };

  static std::unique_ptr<Transport> named(const std::string& name) {
    if (name == "http") return std::make_unique<HttpTransport>();
    if (name == "queue") return std::make_unique<QueueTransport>();
    if (name == "email") return std::make_unique<EmailTransport>();
    throw std::invalid_argument("unknown transport");
  }

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }

  std::string name_;
  std::unique_ptr<Transport> transport_;
  std::vector<Message> queued_;
  std::set<std::string> seen_;
  std::optional<int64_t> limit_;
  std::vector<std::string> dead_;
};
