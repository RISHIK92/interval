#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

constexpr int64_t kPermille = 1000;
constexpr int64_t kPercent = 100;

// An observer of one service. It speaks only when the service's burn crosses its
// threshold, in either direction, so it never repeats itself.
struct Watcher {
  std::string subscriber;
  int64_t threshold;
  bool alerting = false;

  std::optional<std::string> update(int64_t burned) {
    bool burning = burned >= threshold;
    if (burning == alerting) return std::nullopt;
    alerting = burning;
    return subscriber + (burning ? " burning" : " recovered");
  }
};

// The subject: its request counts, and the watchers it tells after each change, in the
// order they first watched.
struct Service {
  int64_t good = 0;
  int64_t bad = 0;
  std::vector<std::string> order;
  std::map<std::string, Watcher> watchers;

  int64_t burned(int64_t allowed) const {
    int64_t total = good + bad;
    if (total == 0) return 0;
    return bad * kPermille * kPercent / (total * allowed);
  }
};

class SloMonitor {
 public:
  explicit SloMonitor(int64_t objectivePermille) : allowed_(kPermille - objectivePermille) {
    if (objectivePermille <= 0 || objectivePermille >= kPermille)
      throw std::invalid_argument("an objective from 1 to 999 permille");
  }

  void watch(std::string subscriber, std::string service, int64_t burnPercent) {
    if (subscriber.empty() || service.empty() || burnPercent <= 0 || burnPercent > kPercent)
      throw std::invalid_argument("an empty name or a threshold outside 1 to 100");
    Service& subject = services_[service];
    auto known = subject.watchers.find(subscriber);
    if (known != subject.watchers.end()) {
      known->second.threshold = burnPercent;
      return;
    }
    subject.order.push_back(subscriber);
    subject.watchers.emplace(subscriber, Watcher{subscriber, burnPercent});
  }

  std::vector<std::string> observe(std::string service, int64_t good, int64_t bad) {
    if (service.empty() || good < 0 || bad < 0)
      throw std::invalid_argument("an empty service or a negative count");
    Service& subject = services_[service];
    subject.good += good;
    subject.bad += bad;
    int64_t burned = subject.burned(allowed_);
    std::vector<std::string> told;
    for (const auto& name : subject.order) {
      auto message = subject.watchers.at(name).update(burned);
      if (message) told.push_back(*message);
    }
    return told;
  }

  int64_t budgetLeft(std::string service) {
    if (service.empty()) throw std::invalid_argument("an empty service");
    auto found = services_.find(service);
    return kPercent - (found == services_.end() ? 0 : found->second.burned(allowed_));
  }

  // The extension round: a watcher leaves, and coming back starts afresh at the end.
  bool unwatch(std::string subscriber, std::string service) {
    if (subscriber.empty() || service.empty()) throw std::invalid_argument("an empty name");
    auto found = services_.find(service);
    if (found == services_.end() || found->second.watchers.erase(subscriber) == 0) return false;
    auto& order = found->second.order;
    for (auto it = order.begin(); it != order.end(); ++it) {
      if (*it == subscriber) {
        order.erase(it);
        break;
      }
    }
    return true;
  }

 private:
  int64_t allowed_;
  std::map<std::string, Service> services_;
};
