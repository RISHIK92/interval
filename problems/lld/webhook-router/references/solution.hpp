#pragma once
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace webhook_router {

struct Matcher {
  virtual ~Matcher() = default;
  virtual bool matches(const std::string& event) const = 0;
};

struct Exact : Matcher {
  std::string name;
  explicit Exact(std::string n) : name(std::move(n)) {}
  bool matches(const std::string& event) const override { return event == name; }
};

struct Prefix : Matcher {
  std::string prefix;
  explicit Prefix(std::string p) : prefix(std::move(p)) {}
  bool matches(const std::string& event) const override { return event.rfind(prefix, 0) == 0; }
};

struct Anything : Matcher {
  bool matches(const std::string&) const override { return true; }
};

using Kind = std::function<std::shared_ptr<Matcher>(const std::string&)>;

// Each kind of matcher recognises its own patterns. A new kind is a new entry here and a
// new class; the router and the existing kinds never change.
inline const std::vector<Kind>& kinds() {
  static const std::vector<Kind> all = {
      [](const std::string& pattern) -> std::shared_ptr<Matcher> {
        if (pattern.find('*') != std::string::npos) return nullptr;
        return std::make_shared<Exact>(pattern);
      },
      [](const std::string& pattern) -> std::shared_ptr<Matcher> {
        if (pattern.size() < 3 || pattern.compare(pattern.size() - 2, 2, ".*") != 0) return nullptr;
        std::string stem = pattern.substr(0, pattern.size() - 2);
        if (stem.find('*') != std::string::npos) return nullptr;
        return std::make_shared<Prefix>(stem + ".");
      },
      [](const std::string& pattern) -> std::shared_ptr<Matcher> {
        if (pattern != "*") return nullptr;
        return std::make_shared<Anything>();
      },
  };
  return all;
}

inline std::shared_ptr<Matcher> matcher(const std::string& pattern) {
  for (const Kind& kind : kinds())
    if (std::shared_ptr<Matcher> found = kind(pattern)) return found;
  throw std::invalid_argument("not a pattern");
}

inline const std::string& named(const std::string& text) {
  if (text.empty()) throw std::invalid_argument("an empty name");
  return text;
}

struct Route {
  std::string pattern;
  std::string handler;
  std::shared_ptr<Matcher> matcher;
};

}  // namespace webhook_router

class WebhookRouter {
 public:
  WebhookRouter() {}

  void route(std::string pattern, std::string handler) {
    auto found = webhook_router::matcher(webhook_router::named(pattern));
    webhook_router::named(handler);
    for (const auto& r : routes_)
      if (r.pattern == pattern && r.handler == handler) return;
    routes_.push_back({pattern, handler, found});
  }

  std::vector<std::string> deliver(std::string event) {
    if (webhook_router::named(event).find('*') != std::string::npos)
      throw std::invalid_argument("an event has no wildcard");
    std::vector<std::string> handlers;
    for (const auto& route : routes_)
      if (std::find(handlers.begin(), handlers.end(), route.handler) == handlers.end() &&
          route.matcher->matches(event) && !excluded(route.handler, event))
        handlers.push_back(route.handler);
    return handlers;
  }

  int64_t unroute(std::string handler) {
    webhook_router::named(handler);
    std::vector<webhook_router::Route> kept;
    for (const auto& r : routes_)
      if (r.handler != handler) kept.push_back(r);
    int64_t removed = static_cast<int64_t>(routes_.size() - kept.size());
    routes_ = kept;
    exclusions_.erase(handler);
    return removed;
  }

  // The extension round: a negative matcher is any matcher, used to skip a handler.
  void exclude(std::string handler, std::string pattern) {
    auto found = webhook_router::matcher(webhook_router::named(pattern));
    exclusions_[webhook_router::named(handler)].emplace(pattern, found);
  }

 private:
  bool excluded(const std::string& handler, const std::string& event) const {
    auto it = exclusions_.find(handler);
    if (it == exclusions_.end()) return false;
    for (const auto& [pattern, m] : it->second)
      if (m->matches(event)) return true;
    return false;
  }

  std::vector<webhook_router::Route> routes_;
  std::map<std::string, std::map<std::string, std::shared_ptr<webhook_router::Matcher>>> exclusions_;
};
