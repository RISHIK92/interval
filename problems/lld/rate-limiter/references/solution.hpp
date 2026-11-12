#pragma once
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>

class RateLimiter {
 public:
  RateLimiter(int64_t limit, int64_t windowMs) : limit_(limit), window_(windowMs) {
    if (limit < 1 || windowMs < 1) throw std::invalid_argument("limit and window must be at least 1");
  }

  bool allow(std::string client, int64_t nowMs) {
    std::lock_guard<std::mutex> hold(mu_);
    std::deque<int64_t>& entries = current(client, nowMs);
    if (static_cast<int64_t>(entries.size()) >= limit_) return false;
    entries.push_back(nowMs);
    return true;
  }

  int64_t remaining(std::string client, int64_t nowMs) {
    std::lock_guard<std::mutex> hold(mu_);
    return limit_ - static_cast<int64_t>(current(client, nowMs).size());
  }

 private:
  std::deque<int64_t>& current(const std::string& client, int64_t now) {
    auto it = last_.find(client);
    if (it != last_.end() && now < it->second) throw std::runtime_error("time went backwards");
    last_[client] = now;
    std::deque<int64_t>& entries = log_[client];
    while (!entries.empty() && entries.front() <= now - window_) entries.pop_front();
    return entries;
  }

  int64_t limit_;
  int64_t window_;
  // Each client's allowed requests, oldest first, and the time of its last call.
  std::map<std::string, std::deque<int64_t>> log_;
  std::map<std::string, int64_t> last_;
  std::mutex mu_;
};
