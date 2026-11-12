#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <vector>

class MeetingRooms {
 public:
  MeetingRooms(int64_t count) {
    if (count < 1) throw std::invalid_argument("count must be at least 1");
    rooms_.resize(static_cast<size_t>(count));
  }

  std::optional<int64_t> book(int64_t start, int64_t end) {
    if (end <= start) throw std::invalid_argument("end must be after start");
    std::lock_guard<std::mutex> hold(mu_);
    for (size_t i = 0; i < rooms_.size(); i++) {
      bool clear = true;
      for (const auto& [s, e] : rooms_[i])
        if (start < e && s < end) clear = false;
      if (!clear) continue;
      rooms_[i][start] = end;
      return static_cast<int64_t>(i) + 1;
    }
    return std::nullopt;
  }

  bool cancel(int64_t room, int64_t start) {
    std::lock_guard<std::mutex> hold(mu_);
    if (room < 1 || room > static_cast<int64_t>(rooms_.size())) return false;
    return rooms_[static_cast<size_t>(room - 1)].erase(start) > 0;
  }

  int64_t free(int64_t at) {
    std::lock_guard<std::mutex> hold(mu_);
    int64_t count = 0;
    for (const auto& meetings : rooms_) {
      bool busy = false;
      for (const auto& [s, e] : meetings)
        if (s <= at && at < e) busy = true;
      if (!busy) count++;
    }
    return count;
  }

 private:
  // Each room's meetings, start -> end.
  std::vector<std::map<int64_t, int64_t>> rooms_;
  std::mutex mu_;
};
