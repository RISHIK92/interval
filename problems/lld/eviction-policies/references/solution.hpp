#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>

// A cached value and its usage history. Every policy reads the same history, so
// switching never loses it.
struct CacheEntry {
  int64_t value;
  int64_t entered;
  int64_t used;
  int64_t uses;
};

// Each strategy only ranks entries; the lowest rank is evicted.
class EvictionPolicy {
 public:
  virtual ~EvictionPolicy() = default;
  virtual std::tuple<int64_t, int64_t> rank(const CacheEntry& e) const = 0;
};

class LruPolicy : public EvictionPolicy {
 public:
  std::tuple<int64_t, int64_t> rank(const CacheEntry& e) const override { return {e.used, 0}; }
};

class LfuPolicy : public EvictionPolicy {
 public:
  std::tuple<int64_t, int64_t> rank(const CacheEntry& e) const override { return {e.uses, e.used}; }
};

class FifoPolicy : public EvictionPolicy {
 public:
  std::tuple<int64_t, int64_t> rank(const CacheEntry& e) const override { return {e.entered, 0}; }
};

inline const EvictionPolicy* findPolicy(const std::string& name) {
  static const LruPolicy lru;
  static const LfuPolicy lfu;
  static const FifoPolicy fifo;
  if (name == "lru") return &lru;
  if (name == "lfu") return &lfu;
  if (name == "fifo") return &fifo;
  return nullptr;
}

class EvictingCache {
 public:
  EvictingCache(int64_t capacity, std::string policy) : capacity_(capacity), policy_(findPolicy(policy)) {
    if (capacity < 1 || policy_ == nullptr) throw std::invalid_argument("bad capacity or policy");
  }

  void put(std::string key, int64_t val) {
    if (key.empty()) throw std::invalid_argument("an empty key");
    auto found = entries_.find(key);
    if (found != entries_.end()) {
      found->second.value = val;
      use(found->second);
      return;
    }
    if (static_cast<int64_t>(entries_.size()) >= capacity_) evict();
    int64_t stamp = ++clock_;
    entries_[key] = CacheEntry{val, stamp, stamp, 1};
  }

  std::optional<int64_t> lookup(std::string key) {
    if (key.empty()) throw std::invalid_argument("an empty key");
    auto found = entries_.find(key);
    if (found == entries_.end()) return std::nullopt;
    use(found->second);
    return found->second.value;
  }

  std::vector<std::string> keys() {
    std::vector<std::string> out;
    for (const auto& [key, entry] : entries_) out.push_back(key);
    return out;
  }

  void switchPolicy(std::string policy) {
    const EvictionPolicy* chosen = findPolicy(policy);
    if (chosen == nullptr) throw std::invalid_argument("unknown policy");
    policy_ = chosen;
  }

  // The extension round: a pinned key is passed over by every policy.
  void pinKey(std::string key) {
    if (entries_.count(key) == 0) throw std::invalid_argument("not cached");
    pinned_.insert(key);
  }

 private:
  void use(CacheEntry& entry) {
    entry.used = ++clock_;
    entry.uses++;
  }

  void evict() {
    auto victim = entries_.end();
    for (auto it = entries_.begin(); it != entries_.end(); ++it) {
      if (pinned_.count(it->first) > 0) continue;
      if (victim == entries_.end() || policy_->rank(it->second) < policy_->rank(victim->second)) victim = it;
    }
    if (victim == entries_.end()) throw std::invalid_argument("every key is pinned");
    entries_.erase(victim);
  }

  int64_t capacity_;
  const EvictionPolicy* policy_;
  std::map<std::string, CacheEntry> entries_;
  std::set<std::string> pinned_;
  int64_t clock_ = 0;
};
