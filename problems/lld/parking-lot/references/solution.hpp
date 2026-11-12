#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

class ParkingLot {
 public:
  ParkingLot(int64_t small, int64_t large) {
    if (small < 0 || large < 0) throw std::invalid_argument("negative spot count");
    for (int64_t i = 1; i <= small; i++) spots_["small"].insert(i);
    for (int64_t i = 1; i <= large; i++) spots_["large"].insert(i);
  }

  std::optional<std::string> park(std::string plate, std::string size) {
    std::lock_guard<std::mutex> hold(mu_);
    known(size);
    if (cars_.count(plate)) throw std::runtime_error("already parked");
    std::vector<std::string> kinds = size == "small" ? std::vector<std::string>{"small", "large"}
                                                     : std::vector<std::string>{"large"};
    for (const std::string& kind : kinds) {
      std::set<int64_t>& open = spots_[kind];
      if (open.empty()) continue;
      int64_t number = *open.begin();
      open.erase(open.begin());
      cars_[plate] = {kind, number};
      return label(kind, number);
    }
    return std::nullopt;
  }

  std::optional<std::string> leave(std::string plate) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = cars_.find(plate);
    if (it == cars_.end()) return std::nullopt;
    auto [kind, number] = it->second;
    cars_.erase(it);
    spots_[kind].insert(number);
    return label(kind, number);
  }

  std::optional<std::string> where(std::string plate) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = cars_.find(plate);
    if (it == cars_.end()) return std::nullopt;
    return label(it->second.first, it->second.second);
  }

  int64_t free(std::string size) {
    std::lock_guard<std::mutex> hold(mu_);
    known(size);
    return static_cast<int64_t>(spots_[size].size());
  }

 private:
  static void known(const std::string& size) {
    if (size != "small" && size != "large") throw std::invalid_argument("unknown size");
  }

  static std::string label(const std::string& kind, int64_t number) {
    return (kind == "small" ? "S" : "L") + std::to_string(number);
  }

  // Free spot numbers per size: the lowest is always first.
  std::map<std::string, std::set<int64_t>> spots_;
  std::map<std::string, std::pair<std::string, int64_t>> cars_;
  std::mutex mu_;
};
