#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// A subscriber: it keeps a local cache and drops a key when it hears it changed.
struct AppNode {
  std::map<std::string, std::string> cache;
  // The bus version when it went offline, or nothing while it is online.
  std::optional<size_t> downAt;
  std::vector<std::string> prefixes;  // none means it hears every key

  bool hears(const std::string& key) const {
    if (prefixes.empty()) return true;
    return std::any_of(prefixes.begin(), prefixes.end(),
                       [&](const std::string& p) { return key.compare(0, p.size(), p) == 0; });
  }

  void invalidate(const std::string& key) { cache.erase(key); }
};

// The publisher: every write is numbered and announced to the nodes online.
class InvalidationBus {
 public:
  void join(std::string node) {
    if (node.empty() || nodes_.count(node)) throw std::invalid_argument("empty or joined");
    nodes_[node] = AppNode{};
  }

  void cacheLocal(std::string node, std::string key, std::string val) {
    AppNode& n = serving(node);
    if (key.empty() || val.empty() || !n.hears(key)) throw std::invalid_argument("empty or outside the keyspace");
    n.cache[key] = val;
  }

  int64_t write(std::string key) {
    if (key.empty()) throw std::invalid_argument("empty key");
    log_.push_back(key);
    // A node never caches a key outside its keyspace, so dropping it there is moot.
    for (auto& [name, n] : nodes_)
      if (!n.downAt) n.invalidate(key);
    return static_cast<int64_t>(log_.size());
  }

  std::optional<std::string> cached(std::string node, std::string key) {
    AppNode& n = serving(node);
    if (key.empty()) throw std::invalid_argument("empty key");
    auto at = n.cache.find(key);
    if (at == n.cache.end()) return std::nullopt;
    return at->second;
  }

  void offline(std::string node, bool down) {
    AppNode& n = find(node);
    if (!n.downAt) {
      if (down) n.downAt = log_.size();
      return;
    }
    if (down) return;
    // It can't know which keys changed while it was away, only that some did.
    bool missed = std::any_of(log_.begin() + static_cast<std::ptrdiff_t>(*n.downAt), log_.end(),
                              [&](const std::string& key) { return n.hears(key); });
    if (missed) n.cache.clear();
    n.downAt.reset();
  }

  // The extension round: a node hears only the keys under its prefixes.
  int64_t keyspace(std::string node, std::string prefix) {
    AppNode& n = find(node);
    if (prefix.empty()) throw std::invalid_argument("empty prefix");
    if (std::find(n.prefixes.begin(), n.prefixes.end(), prefix) == n.prefixes.end()) n.prefixes.push_back(prefix);
    int64_t dropped = 0;
    for (auto it = n.cache.begin(); it != n.cache.end();) {
      if (n.hears(it->first)) {
        ++it;
      } else {
        it = n.cache.erase(it);
        dropped++;
      }
    }
    return dropped;
  }

 private:
  AppNode& find(const std::string& node) {
    auto at = nodes_.find(node);
    if (at == nodes_.end()) throw std::invalid_argument("unknown node");
    return at->second;
  }

  AppNode& serving(const std::string& node) {
    AppNode& n = find(node);
    if (n.downAt) throw std::invalid_argument("the node is offline");
    return n;
  }

  std::map<std::string, AppNode> nodes_;
  std::vector<std::string> log_;  // the key of each write, version 1 first
};
