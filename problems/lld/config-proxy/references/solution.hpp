#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>

// The upstream didn't answer.
struct Unavailable : std::runtime_error {
  using std::runtime_error::runtime_error;
};

// The slow upstream: it counts every call made to it, and while it's down every call
// fails.
struct ConfigService {
  std::map<std::string, std::string> values;
  bool down = false;
  int64_t calls = 0;

  std::optional<std::string> fetch(const std::string& key) {
    calls += 1;
    if (down) throw Unavailable(key);
    auto it = values.find(key);
    if (it == values.end()) return std::nullopt;
    return it->second;
  }
};

// Stands in front of the config service with the same job, reading a key, and calls
// through only when its copy is missing or older than the TTL. When the call fails, a
// stale copy is better than nothing.
class ConfigProxy {
 public:
  explicit ConfigProxy(int64_t ttlMs) : ttl_(ttlMs) {
    if (ttlMs < 1 || ttlMs > kMaxTtlMs) throw std::invalid_argument("ttl out of range");
  }

  void upstreamSet(std::string key, std::string val) {
    given(key);
    given(val);
    upstream_.values[key] = val;
  }

  std::optional<std::string> read(std::string key, int64_t nowMs) {
    given(key);
    auto kept = cache_.find(key);
    bool have = kept != cache_.end();
    if (have && nowMs - kept->second.fetchedMs < ttl_) return kept->second.value;
    std::optional<std::string> value;
    try {
      value = upstream_.fetch(key);
    } catch (const Unavailable&) {
      if (have) return kept->second.value;
      return std::nullopt;
    }
    if (value) cache_[key] = Entry{*value, nowMs};
    return value;
  }

  void upstreamDown(bool down) { upstream_.down = down; }

  int64_t upstreamFetches() { return upstream_.calls; }

  // The extension round: dropping a copy before its time.
  void invalidate(std::string key) {
    given(key);
    cache_.erase(key);
  }

 private:
  static constexpr int64_t kMaxTtlMs = 1000000000;

  struct Entry {
    std::string value;
    int64_t fetchedMs;
  };

  int64_t ttl_;
  ConfigService upstream_;
  std::map<std::string, Entry> cache_;

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }
};
