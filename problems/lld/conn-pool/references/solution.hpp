#pragma once
#include <algorithm>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>

// Every public method takes the lock, so two threads can never take the same idle
// connection or both grow the pool past its maximum.
class ConnPool {
 public:
  explicit ConnPool(int64_t maxSize) : max_(maxSize) {
    if (maxSize < 1 || maxSize > 1000) throw std::invalid_argument("maxSize is 1 to 1000");
  }

  std::optional<std::string> acquire(std::string client) {
    if (client.empty()) throw std::invalid_argument("clients are named");
    std::lock_guard<std::mutex> guard(mutex_);
    std::string conn;
    if (!idle_.empty()) {
      conn = idle_.back();
      idle_.pop_back();
    } else {
      if (static_cast<int64_t>(held_.size()) >= max_) return std::nullopt;
      conn = "conn-" + std::to_string(made_.size() + 1);
      made_.insert(conn);
    }
    held_[conn] = client;
    return conn;
  }

  bool release(std::string conn) {
    std::lock_guard<std::mutex> guard(mutex_);
    known(conn);
    if (held_.erase(conn) == 0) return false;
    idle_.push_back(conn);
    return true;
  }

  bool invalidate(std::string conn) {
    std::lock_guard<std::mutex> guard(mutex_);
    known(conn);
    auto at = std::find(idle_.begin(), idle_.end(), conn);
    if (at != idle_.end()) {
      idle_.erase(at);
      return true;
    }
    return held_.erase(conn) > 0;
  }

  int64_t created() {
    std::lock_guard<std::mutex> guard(mutex_);
    return static_cast<int64_t>(made_.size());
  }

  int64_t idle() {
    std::lock_guard<std::mutex> guard(mutex_);
    return static_cast<int64_t>(idle_.size());
  }

  // The extension round: close the coldest idle connections past a limit.
  int64_t shrink(int64_t maxIdle) {
    if (maxIdle < 0) throw std::invalid_argument("maxIdle is not negative");
    std::lock_guard<std::mutex> guard(mutex_);
    int64_t closing = std::max<int64_t>(static_cast<int64_t>(idle_.size()) - maxIdle, 0);
    idle_.erase(idle_.begin(), idle_.begin() + closing);
    return closing;
  }

 private:
  void known(const std::string& conn) const {
    if (made_.count(conn) == 0) throw std::out_of_range("not a connection this pool made");
  }

  int64_t max_;
  // Every connection ever made, including the discarded ones.
  std::set<std::string> made_;
  // Most recently released last: reusing from the end keeps the warmest connection busy
  // and lets the coldest ones age out.
  std::deque<std::string> idle_;
  std::map<std::string, std::string> held_;
  std::mutex mutex_;
};
