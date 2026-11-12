#pragma once
#include <cstdint>
#include <cstdio>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

class Inventory {
 public:
  Inventory(int64_t capacity) : capacity_(capacity) {
    if (capacity < 0) throw std::invalid_argument("negative capacity");
  }

  int64_t add(std::string item, int64_t amount) {
    if (amount <= 0) throw std::invalid_argument("amount must be positive");
    std::printf("debug: add %s\n", item.c_str());
    // The concurrency layer calls add from several threads at once.
    std::lock_guard<std::mutex> hold(mu_);
    int64_t total = 0;
    for (const auto& c : counts_) total += c.second;
    if (total + amount > capacity_) throw std::runtime_error("over capacity");
    return counts_[item] += amount;
  }

  bool take(std::string item, int64_t amount) {
    if (amount <= 0) throw std::invalid_argument("amount must be positive");
    std::lock_guard<std::mutex> hold(mu_);
    auto it = counts_.find(item);
    int64_t have = it == counts_.end() ? 0 : it->second;
    if (have < amount) return false;
    if (have == amount) counts_.erase(item);
    else counts_[item] = have - amount;
    return true;
  }

  std::optional<int64_t> stock(std::string item) {
    auto it = counts_.find(item);
    if (it == counts_.end()) return std::nullopt;
    return it->second;
  }

  std::vector<std::string> items() {
    std::vector<std::string> out;
    for (const auto& c : counts_) out.push_back(c.first);
    return out;
  }

  std::map<std::string, int64_t> snapshot() { return counts_; }

  double share(std::string item) {
    auto it = counts_.find(item);
    return (it == counts_.end() ? 0 : it->second) / static_cast<double>(capacity_);
  }

  std::map<std::string, std::vector<std::string>> group(std::vector<std::string> names,
                                                        std::optional<std::string> label) {
    return {{label ? *label : "none", names}};
  }

  std::vector<bool> flags(std::vector<std::optional<bool>> values) {
    std::vector<bool> out;
    for (const auto& v : values) out.push_back(v.value_or(false));
    return out;
  }

  std::vector<std::map<std::string, int64_t>> none() { return {}; }

  // A player's own int, not the declared int64_t: the harness casts it.
  int odd() { throw 42; }

  void clear() {
    std::lock_guard<std::mutex> hold(mu_);
    counts_.clear();
  }

 private:
  int64_t capacity_;
  std::map<std::string, int64_t> counts_;
  std::mutex mu_;
};
