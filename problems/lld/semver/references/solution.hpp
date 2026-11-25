#pragma once
#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>

class SemVer {
 public:
  SemVer(std::string text) : version_(parse(text)) {}

  std::string bump(std::string part) {
    auto [major, minor, patch] = version_;
    if (part == "major") return std::to_string(major + 1) + ".0.0";
    if (part == "minor") return std::to_string(major) + "." + std::to_string(minor + 1) + ".0";
    if (part == "patch") return std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(patch + 1);
    throw std::invalid_argument("part is major, minor or patch");
  }

  int64_t compareTo(std::string other) { return compare(version_, parse(other)); }

  bool isCompatible(std::string other) { return compatible(version_, parse(other)); }

  std::string text() {
    return std::to_string(version_[0]) + "." + std::to_string(version_[1]) + "." + std::to_string(version_[2]);
  }

  // The extension round.
  bool satisfies(std::string constraint) {
    if (constraint.empty() || (constraint[0] != '^' && constraint[0] != '~'))
      throw std::invalid_argument("a constraint is ^ or ~ and a version");
    Version base = parse(constraint.substr(1));
    if (compare(version_, base) < 0) return false;
    if (constraint[0] == '^') return compatible(version_, base);
    return version_[0] == base[0] && version_[1] == base[1];
  }

 private:
  using Version = std::array<int64_t, 3>;

  // Each part is 1 to 9 digits with no leading zero.
  static Version parse(const std::string& text) {
    Version out{};
    size_t start = 0;
    for (int i = 0; i < 3; i++) {
      size_t end = i < 2 ? text.find('.', start) : text.size();
      if (end == std::string::npos) throw std::invalid_argument("a version is major.minor.patch");
      std::string part = text.substr(start, end - start);
      if (part.empty() || part.size() > 9) throw std::invalid_argument("each part is 1 to 9 digits");
      for (char c : part)
        if (c < '0' || c > '9') throw std::invalid_argument("each part is 1 to 9 digits");
      if (part[0] == '0' && part.size() > 1) throw std::invalid_argument("no leading zeros");
      out[i] = std::stoll(part);
      start = end + 1;
    }
    return out;
  }

  static int64_t compare(const Version& a, const Version& b) {
    for (int i = 0; i < 3; i++)
      if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }

  static bool compatible(const Version& a, const Version& b) {
    if (a[0] != b[0]) return false;
    return a[0] > 0 || a[1] == b[1];
  }

  Version version_;
};
