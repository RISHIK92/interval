#pragma once
#include <cmath>
#include <cstdint>
#include <regex>
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
    static const std::regex pattern("(?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?");
    std::smatch m;
    if (text.empty() || !std::regex_match(text, m, pattern))
      throw std::invalid_argument("a duration is like 1h30m15s");
    auto part = [&m](int i) -> int64_t { return m[i].matched ? std::stoll(m[i].str()) : 0; };
    return part(1) * 3600 + part(2) * 60 + part(3);
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
