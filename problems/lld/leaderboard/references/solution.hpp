#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

class Leaderboard {
 public:
  Leaderboard() {}

  int64_t add(std::string player, int64_t points) {
    if (points <= 0) throw std::invalid_argument("points must be positive");
    std::lock_guard<std::mutex> hold(mu_);
    return totals_[player] += points;
  }

  std::vector<std::string> top(int64_t k) {
    if (k < 0) throw std::invalid_argument("negative k");
    std::lock_guard<std::mutex> hold(mu_);
    std::vector<std::string> players = ordered();
    if (static_cast<int64_t>(players.size()) > k) players.resize(static_cast<size_t>(k));
    return players;
  }

  std::optional<int64_t> rank(std::string player) {
    std::lock_guard<std::mutex> hold(mu_);
    if (!totals_.count(player)) return std::nullopt;
    std::vector<std::string> players = ordered();
    return std::find(players.begin(), players.end(), player) - players.begin() + 1;
  }

  // The extension round.
  std::vector<std::string> around(std::string player, int64_t radius) {
    if (radius < 0) throw std::invalid_argument("negative radius");
    std::lock_guard<std::mutex> hold(mu_);
    if (!totals_.count(player)) return {};
    std::vector<std::string> players = ordered();
    int64_t at = std::find(players.begin(), players.end(), player) - players.begin();
    int64_t size = static_cast<int64_t>(players.size());
    int64_t from = std::max<int64_t>(0, at - radius);
    int64_t to = radius >= size ? size : std::min<int64_t>(size, at + radius + 1);
    return {players.begin() + from, players.begin() + to};
  }

  bool remove(std::string player) {
    std::lock_guard<std::mutex> hold(mu_);
    return totals_.erase(player) > 0;
  }

 private:
  std::vector<std::string> ordered() {
    std::vector<std::string> players;
    for (const auto& t : totals_) players.push_back(t.first);
    std::sort(players.begin(), players.end(), [this](const std::string& a, const std::string& b) {
      if (totals_.at(a) != totals_.at(b)) return totals_.at(a) > totals_.at(b);
      return a < b;
    });
    return players;
  }

  std::map<std::string, int64_t> totals_;
  std::mutex mu_;
};
