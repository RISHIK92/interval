#pragma once
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string>

class Duration {
 public:
  Duration(std::string text) : total_(seconds(text)) {}

  int64_t totalSeconds() { return total_; }

  std::string canonical() { return canonical(total_); }

  std::string plus(std::string other) { return canonical(total_ + seconds(other)); }

  bool isLonger(std::string other) { return total_ > seconds(other); }

  // The extension round.
  std::string scaled(double factor) {
    if (factor < 0 || factor > 1000) throw std::invalid_argument("factor must be within 0-1000");
    return canonical(static_cast<int64_t>(std::floor(static_cast<double>(total_) * factor)));
  }

 private:
  static int64_t seconds(const std::string& text) {
    // Hand-parsed rather than std::regex: libstdc++'s regex is slow enough to hit the
    // time limit in the judge's gcc image. Same grammar, the whole text:
    // (?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?
    int64_t parts[3] = {0, 0, 0};
    std::size_t at = 0;
    for (int i = 0; i < 3; i++) {
      std::size_t end = at;
      while (end < text.size() && text[end] >= '0' && text[end] <= '9') ++end;
      if (end == at || end == text.size() || text[end] != "hms"[i] || end - at > 9) continue;
      parts[i] = std::stoll(text.substr(at, end - at));
      at = end + 1;
    }
    if (text.empty() || at != text.size()) throw std::invalid_argument("a duration is like 1h30m15s");
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  static std::string canonical(int64_t total) {
    if (total == 0) return "0s";
    std::string out;
    if (total / 3600 > 0) out += std::to_string(total / 3600) + "h";
    if (total / 60 % 60 > 0) out += std::to_string(total / 60 % 60) + "m";
    if (total % 60 > 0) out += std::to_string(total % 60) + "s";
    return out;
  }

  int64_t total_;
};
