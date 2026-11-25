#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// The new metrics API: it knows only milliseconds and bytes, and each name is one or the
// other.
class MetricsApi {
 public:
  bool recordMs(const std::string& name, double value) {
    if (bytes_.count(name)) return false;
    ms_[name] = value;
    return true;
  }

  bool recordBytes(const std::string& name, int64_t size) {
    if (ms_.count(name)) return false;
    bytes_[name] = size;
    return true;
  }

  std::optional<double> ms(const std::string& name) const {
    auto it = ms_.find(name);
    if (it == ms_.end()) return std::nullopt;
    return it->second;
  }

  std::optional<int64_t> size(const std::string& name) const {
    auto it = bytes_.find(name);
    if (it == bytes_.end()) return std::nullopt;
    return it->second;
  }

  std::vector<std::string> names() const {
    std::vector<std::string> all;
    for (const auto& kv : ms_) all.push_back(kv.first);
    for (const auto& kv : bytes_) all.push_back(kv.first);
    std::sort(all.begin(), all.end());
    return all;
  }

 private:
  std::map<std::string, double> ms_;
  std::map<std::string, int64_t> bytes_;
};

// Speaks the legacy agent's `name value unit` lines and feeds the new API: the only code
// that knows the old format and units.
class MetricsAdapter {
 public:
  bool ingestLegacy(std::string line) {
    if (line.empty()) throw std::invalid_argument("empty line");
    return ingest(line);
  }

  std::optional<double> gaugeMs(std::string name) {
    named(name);
    return api_.ms(name);
  }

  std::optional<int64_t> gaugeBytes(std::string name) {
    named(name);
    return api_.size(name);
  }

  std::vector<std::string> names() { return api_.names(); }

  // The extension round: a batch of lines, each as ingestLegacy takes it.
  int64_t ingestBatch(std::vector<std::string> lines) {
    int64_t good = 0;
    for (const auto& line : lines)
      if (ingest(line)) good++;
    return good;
  }

 private:
  // The legacy agent's units, each as how many of the new API's base units it is.
  inline static const std::map<std::string, double> kTimeUnits = {
      {"s", 1000.0}, {"ms", 1.0}, {"us", 0.001}};
  inline static const std::map<std::string, int64_t> kSizeUnits = {
      {"B", 1}, {"KB", 1024}, {"MB", 1024 * 1024}};

  MetricsApi api_;

  bool ingest(const std::string& line) {
    std::vector<std::string> fields(1);
    for (char c : line) {
      if (c == ' ')
        fields.emplace_back();
      else
        fields.back() += c;
    }
    if (fields.size() != 3 || fields[0].empty()) return false;
    std::optional<int64_t> value = number(fields[1]);
    if (!value) return false;
    if (auto it = kTimeUnits.find(fields[2]); it != kTimeUnits.end())
      return api_.recordMs(fields[0], static_cast<double>(*value) * it->second);
    if (auto it = kSizeUnits.find(fields[2]); it != kSizeUnits.end())
      return api_.recordBytes(fields[0], *value * it->second);
    return false;
  }

  static std::optional<int64_t> number(const std::string& text) {
    if (text.empty() || text.size() > 9) return std::nullopt;
    int64_t value = 0;
    for (char c : text) {
      if (c < '0' || c > '9') return std::nullopt;
      value = value * 10 + (c - '0');
    }
    return value;
  }

  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("empty name");
  }
};
