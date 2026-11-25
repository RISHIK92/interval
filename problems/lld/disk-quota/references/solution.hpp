#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

class DiskQuota {
 public:
  DiskQuota(int64_t limitBytes) : limit_(limitBytes) {
    if (limitBytes < 0) throw std::invalid_argument("the limit can't be negative");
  }

  bool reserve(std::string owner, int64_t bytes) {
    if (bytes < 1) throw std::invalid_argument("reserve at least one byte");
    if (bytes > limit_ - total_) return false;
    held_[owner] += bytes;
    total_ += bytes;
    return true;
  }

  void release(std::string owner, int64_t bytes) {
    if (bytes < 1) throw std::invalid_argument("release at least one byte");
    int64_t has = used(owner);
    if (bytes > has) throw std::invalid_argument("more than the owner holds");
    if (has == bytes) held_.erase(owner);
    else held_[owner] = has - bytes;
    total_ -= bytes;
  }

  int64_t used(std::string owner) {
    auto it = held_.find(owner);
    return it == held_.end() ? 0 : it->second;
  }

  int64_t free() { return limit_ - total_; }

  // The extension round.
  void softLimit(int64_t bytes) {
    if (bytes < 0) throw std::invalid_argument("the soft limit can't be negative");
    soft_ = bytes;
  }

  std::vector<std::string> warnings() {
    std::vector<std::string> out;
    if (!soft_) return out;
    for (const auto& [owner, has] : held_)
      if (has > *soft_) out.push_back(owner);
    return out;
  }

 private:
  int64_t limit_;
  int64_t total_ = 0;
  // Only owners holding more than 0 bytes, in name order.
  std::map<std::string, int64_t> held_;
  std::optional<int64_t> soft_;
};
