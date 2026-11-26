#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>

// How a key finds its shard; nothing when this strategy has no shard for it.
class Strategy {
 public:
  virtual ~Strategy() = default;
  virtual std::optional<int64_t> shard(const std::string& key, int64_t shards) const = 0;
};

class HashModulo : public Strategy {
 public:
  std::optional<int64_t> shard(const std::string& key, int64_t shards) const override {
    int64_t h = 0;
    for (unsigned char c : key) h = (h * 31 + c) % 1000000007;
    return h % shards;
  }
};

class KeyRange : public Strategy {
 public:
  std::optional<int64_t> shard(const std::string& key, int64_t shards) const override {
    // Printable ASCII split into equal ranges by the first character.
    return (static_cast<int64_t>(key[0]) - 32) * shards / 95;
  }
};

class Directory : public Strategy {
 public:
  explicit Directory(const std::map<std::string, int64_t>& entries) : entries_(entries) {}

  std::optional<int64_t> shard(const std::string& key, int64_t) const override {
    auto at = entries_.find(key);
    if (at == entries_.end()) return std::nullopt;
    return at->second;
  }

 private:
  const std::map<std::string, int64_t>& entries_;
};

class ShardRouter {
 public:
  ShardRouter(int64_t shards, std::string strategy) {
    checkCount(shards);
    shards_ = shards;
    strategies_["hash"] = std::make_unique<HashModulo>();
    strategies_["range"] = std::make_unique<KeyRange>();
    strategies_["directory"] = std::make_unique<Directory>(directory_);
    strategy_ = pick(strategy);
  }

  // The directory strategy refers to this router's table, so a copy would share it.
  ShardRouter(const ShardRouter&) = delete;
  ShardRouter& operator=(const ShardRouter&) = delete;

  int64_t route(std::string key) {
    auto shard = strategy_->shard(checkKey(key), shards_);
    if (!shard) throw std::invalid_argument("no directory entry");
    return *shard;
  }

  void track(std::string key) { tracked_.insert(checkKey(key)); }

  void assignDirectory(std::string key, int64_t shard) {
    checkKey(key);
    if (shard < 0 || shard >= shards_) throw std::invalid_argument("no such shard");
    directory_[key] = shard;
  }

  int64_t rebalance(int64_t shards) {
    checkCount(shards);
    auto before = placement();
    shards_ = shards;
    for (auto& [key, at] : directory_) at %= shards;
    return moved(before);
  }

  // The extension round: switching strategy, reporting what moves.
  int64_t useStrategy(std::string strategy) {
    const Strategy* chosen = pick(strategy);
    auto before = placement();
    strategy_ = chosen;
    return moved(before);
  }

 private:
  using Placement = std::map<std::string, std::optional<int64_t>>;

  const Strategy* pick(const std::string& name) const {
    auto found = strategies_.find(name);
    if (found == strategies_.end()) throw std::invalid_argument("unknown strategy");
    return found->second.get();
  }

  Placement placement() const {
    Placement out;
    for (const auto& key : tracked_) out[key] = strategy_->shard(key, shards_);
    return out;
  }

  int64_t moved(const Placement& before) const {
    Placement after = placement();
    int64_t count = 0;
    for (const auto& key : tracked_) count += before.at(key) != after.at(key) ? 1 : 0;
    return count;
  }

  static void checkCount(int64_t shards) {
    if (shards < 1 || shards > 1000) throw std::invalid_argument("shards out of range");
  }

  static const std::string& checkKey(const std::string& key) {
    if (key.empty()) throw std::invalid_argument("empty key");
    return key;
  }

  int64_t shards_ = 0;
  std::map<std::string, int64_t> directory_;
  std::map<std::string, std::unique_ptr<Strategy>> strategies_;
  const Strategy* strategy_ = nullptr;
  std::set<std::string> tracked_;
};
