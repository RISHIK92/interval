#pragma once
#include <cstdint>
#include <list>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

class LRUCache {
 public:
  LRUCache(int64_t capacity) : capacity_(capacity) {
    if (capacity < 1) throw std::invalid_argument("capacity must be at least 1");
  }

  std::optional<int64_t> lookup(std::string key) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = index_.find(key);
    if (it == index_.end()) return std::nullopt;
    order_.splice(order_.begin(), order_, it->second);
    return it->second->second;
  }

  void put(std::string key, int64_t value) {
    if (value < 0) throw std::invalid_argument("negative value");
    std::lock_guard<std::mutex> hold(mu_);
    auto it = index_.find(key);
    if (it != index_.end()) {
      it->second->second = value;
      order_.splice(order_.begin(), order_, it->second);
      return;
    }
    order_.emplace_front(key, value);
    index_[key] = order_.begin();
    if (static_cast<int64_t>(order_.size()) > capacity_) {
      index_.erase(order_.back().first);
      order_.pop_back();
    }
  }

  int64_t size() {
    std::lock_guard<std::mutex> hold(mu_);
    return static_cast<int64_t>(order_.size());
  }

  // The extension round.
  void resize(int64_t capacity) {
    if (capacity < 1) throw std::invalid_argument("capacity must be at least 1");
    std::lock_guard<std::mutex> hold(mu_);
    capacity_ = capacity;
    while (static_cast<int64_t>(order_.size()) > capacity_) {
      index_.erase(order_.back().first);
      order_.pop_back();
    }
  }

  std::optional<int64_t> peek(std::string key) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = index_.find(key);
    if (it == index_.end()) return std::nullopt;
    return it->second->second;
  }

  std::vector<std::string> keys() {
    std::lock_guard<std::mutex> hold(mu_);
    std::vector<std::string> out;
    for (const auto& e : order_) out.push_back(e.first);
    return out;
  }

 private:
  int64_t capacity_;
  // Most recently used first.
  std::list<std::pair<std::string, int64_t>> order_;
  std::unordered_map<std::string, std::list<std::pair<std::string, int64_t>>::iterator> index_;
  std::mutex mu_;
};
