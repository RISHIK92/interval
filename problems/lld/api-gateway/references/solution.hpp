#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A fake upstream: answers with its statuses in order, then repeats the last.
class ScriptedService {
 public:
  explicit ScriptedService(std::vector<int64_t> statuses) : statuses_(std::move(statuses)) {}

  int64_t answer() {
    int64_t status = statuses_[std::min(served_, statuses_.size() - 1)];
    served_++;
    return status;
  }

 private:
  std::vector<int64_t> statuses_;
  size_t served_ = 0;
};

// One prefix's settings and, when it caches, its own responses by path.
struct Route {
  struct Cached {
    int64_t status;
    int64_t expires;
  };

  std::string service;
  bool auth = false;
  int64_t ttl = 0;
  std::map<std::string, Cached> cached;
};

// The facade: one request call hides routing, the auth check, the response cache (a
// proxy in front of each service) and the services themselves.
class Gateway {
 public:
  Gateway() = default;

  void route(std::string prefix, std::string service) {
    checkPrefix(prefix);
    if (service.empty()) throw std::invalid_argument("an empty service");
    auto found = routes_.find(prefix);
    if (found == routes_.end()) {
      routes_[prefix] = Route{service};
    } else {
      found->second.service = service;
      found->second.cached.clear();
    }
  }

  void requireAuth(std::string prefix) { find(prefix).auth = true; }

  void cache(std::string prefix, int64_t ttlMs) {
    Route& r = find(prefix);
    if (ttlMs < 1) throw std::invalid_argument("a ttl is at least 1 ms");
    r.ttl = ttlMs;
  }

  void upstream(std::string service, std::vector<int64_t> statuses) {
    if (service.empty() || statuses.empty()) throw std::invalid_argument("an empty service or script");
    for (int64_t s : statuses)
      if (s < 100 || s > 599) throw std::invalid_argument("not an HTTP status");
    services_.insert_or_assign(service, ScriptedService(statuses));
  }

  std::vector<std::string> request(std::string path, std::string token, int64_t nowMs) {
    checkPath(path);
    auto rewrite = longest(rewrites_, path);
    if (rewrite) path = rewrites_[*rewrite] + path.substr(rewrite->size());
    auto prefix = longest(routes_, path);
    if (!prefix) return {"404", kNone, kNone};
    Route& r = routes_[*prefix];
    if (r.auth && token.empty()) return {"401", kNone, kNone};
    auto kept = r.cached.find(path);
    if (kept != r.cached.end() && nowMs < kept->second.expires)
      return {std::to_string(kept->second.status), r.service, "hit"};
    auto service = services_.find(r.service);
    if (service == services_.end()) return {"502", kNone, kNone};
    int64_t status = service->second.answer();
    if (r.ttl == 0) return {std::to_string(status), r.service, kNone};
    if (status == 200) r.cached[path] = Route::Cached{status, nowMs + r.ttl};
    return {std::to_string(status), r.service, "miss"};
  }

  // The extension round: a path rewrite in front of the routing.
  void rewrite(std::string prefix, std::string replacement) {
    checkPrefix(prefix);
    checkPrefix(replacement);
    if (prefix == "/" || replacement == "/") throw std::invalid_argument("/ can't be rewritten or be a rewrite");
    rewrites_[prefix] = replacement;
  }

 private:
  static constexpr const char* kNone = "-";

  static void checkPath(const std::string& path) {
    if (path.empty() || path[0] != '/') throw std::invalid_argument("a path starts with /");
  }

  static void checkPrefix(const std::string& prefix) {
    checkPath(prefix);
    if (prefix != "/" && prefix.back() == '/') throw std::invalid_argument("only / itself ends with /");
  }

  static bool matches(const std::string& prefix, const std::string& path) {
    return prefix == "/" || path == prefix || path.rfind(prefix + "/", 0) == 0;
  }

  // Prefixes that match one path are nested, so the longest is the most specific.
  template <class V>
  static std::optional<std::string> longest(const std::map<std::string, V>& prefixes, const std::string& path) {
    std::optional<std::string> best;
    for (const auto& [prefix, unused] : prefixes)
      if (matches(prefix, path) && (!best || prefix.size() > best->size())) best = prefix;
    return best;
  }

  Route& find(const std::string& prefix) {
    auto found = routes_.find(prefix);
    if (found == routes_.end()) throw std::out_of_range("no such route");
    return found->second;
  }

  std::map<std::string, Route> routes_;
  std::map<std::string, ScriptedService> services_;
  std::map<std::string, std::string> rewrites_;
};
