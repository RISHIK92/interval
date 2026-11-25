#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// When a user doesn't want to be disturbed; knows nothing about channels. The same
// start and end is an empty window.
class QuietHours {
 public:
  QuietHours(int64_t start, int64_t end) : start_(start), end_(end) {}

  bool contains(int64_t hour) const {
    if (start_ <= end_) return hour >= start_ && hour < end_;
    return hour >= start_ || hour < end_;  // wraps past midnight
  }

 private:
  int64_t start_;
  int64_t end_;
};

// What one user chose. It answers questions about itself and never routes.
struct Preferences {
  std::set<std::string> optedOut;
  std::optional<QuietHours> quiet;
  std::set<std::string> digested;
  std::map<std::string, int64_t> pending;  // channel -> messages held for the digest

  bool isQuiet(int64_t hour) const { return quiet && quiet->contains(hour); }
};

// Keeps preferences and decides delivery; sending is someone else's job.
class NotificationPrefs {
 public:
  NotificationPrefs() {}

  void optOut(std::string user, std::string channel) {
    check(user, channel);
    Preferences& prefs = users_[user];
    prefs.optedOut.insert(channel);
    prefs.pending.erase(channel);
  }

  void quietHours(std::string user, int64_t startHour, int64_t endHour) {
    check(user);
    checkHour(startHour);
    checkHour(endHour);
    users_[user].quiet = QuietHours(startHour, endHour);
  }

  bool route(std::string user, std::string channel, int64_t hour, bool urgent) {
    check(user, channel);
    checkHour(hour);
    Preferences& prefs = users_[user];
    if (prefs.optedOut.count(channel) > 0) return false;
    if (urgent) return true;
    if (prefs.digested.count(channel) > 0) {
      prefs.pending[channel]++;
      return false;
    }
    return !prefs.isQuiet(hour);
  }

  std::vector<std::string> channels(std::string user) {
    check(user);
    const Preferences& prefs = users_[user];
    std::vector<std::string> out;
    for (const auto& c : kChannels)
      if (prefs.optedOut.count(c) == 0) out.push_back(c);
    return out;
  }

  // The extension round: non-urgent messages on a digest channel wait for the digest.
  void digest(std::string user, std::string channel) {
    check(user, channel);
    users_[user].digested.insert(channel);
  }

  int64_t flushDigest(std::string user) {
    check(user);
    Preferences& prefs = users_[user];
    int64_t held = 0;
    for (const auto& [channel, n] : prefs.pending) held += n;
    prefs.pending.clear();
    return held;
  }

 private:
  static inline const std::array<std::string, 3> kChannels = {"email", "push", "sms"};  // sorted

  static void check(const std::string& user) {
    if (user.empty()) throw std::invalid_argument("a user is not empty");
  }

  static void check(const std::string& user, const std::string& channel) {
    check(user);
    if (std::find(kChannels.begin(), kChannels.end(), channel) == kChannels.end())
      throw std::invalid_argument("unknown channel");
  }

  static void checkHour(int64_t hour) {
    if (hour < 0 || hour > 23) throw std::invalid_argument("an hour is from 0 to 23");
  }

  std::map<std::string, Preferences> users_;
};
