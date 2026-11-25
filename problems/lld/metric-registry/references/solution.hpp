#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

class MetricRegistry {
 public:
  MetricRegistry() {}

  int64_t inc(std::string name, int64_t by) {
    if (by < 1 || by > kMaxStep) throw std::invalid_argument("a counter goes up by 1 to 10^9");
    claim(name, gauges_);
    return counters_[name] += by;
  }

  void gauge(std::string name, int64_t value) {
    if (value < -kMaxReading || value > kMaxReading)
      throw std::invalid_argument("a gauge reads within -10^12 and 10^12");
    claim(name, counters_);
    gauges_[name] = value;
  }

  std::optional<int64_t> read(std::string name) {
    if (auto it = counters_.find(name); it != counters_.end()) return it->second;
    if (auto it = gauges_.find(name); it != gauges_.end()) return it->second;
    return std::nullopt;
  }

  // std::map keeps its keys in byte order, so merging two sorted key lists keeps it.
  std::vector<std::string> names() {
    std::map<std::string, int64_t> all(counters_);
    all.insert(gauges_.begin(), gauges_.end());
    std::vector<std::string> out;
    for (const auto& [name, value] : all) out.push_back(name);
    return out;
  }

  // The extension round.
  std::map<std::string, int64_t> snapshotAndReset() {
    std::map<std::string, int64_t> snapshot = counters_;
    for (auto& [name, value] : counters_) value = 0;
    return snapshot;
  }

 private:
  static constexpr int64_t kMaxStep = 1000000000LL;
  static constexpr int64_t kMaxReading = 1000000000000LL;

  // A name belongs to one kind for good: the other kind's map must not hold it.
  static void claim(const std::string& name, const std::map<std::string, int64_t>& other) {
    if (name.empty() || other.count(name) > 0)
      throw std::invalid_argument("a metric needs a non-empty name of its own kind");
  }

  std::map<std::string, int64_t> counters_;
  std::map<std::string, int64_t> gauges_;
};
