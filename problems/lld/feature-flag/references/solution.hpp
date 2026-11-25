#pragma once
#include <cstdint>
#include <set>
#include <stdexcept>
#include <string>

class FeatureFlag {
 public:
  FeatureFlag(std::string name, int64_t rolloutPercent) : name_(name), percent_(checkedPercent(rolloutPercent)) {
    if (name.empty()) throw std::invalid_argument("a flag needs a name");
  }

  bool enabledFor(int64_t userBucket) {
    int64_t bucket = checkedBucket(userBucket);
    if (killed_) return false;
    return allowed_.count(bucket) > 0 || bucket < percent_;
  }

  void setRollout(int64_t percent) { percent_ = checkedPercent(percent); }

  void kill() { killed_ = true; }

  void revive() { killed_ = false; }

  // The extension round.
  void allow(int64_t userBucket) { allowed_.insert(checkedBucket(userBucket)); }

 private:
  static int64_t checkedPercent(int64_t percent) {
    if (percent < 0 || percent > 100) throw std::invalid_argument("percent must be within 0-100");
    return percent;
  }

  static int64_t checkedBucket(int64_t bucket) {
    if (bucket < 0 || bucket > 99) throw std::invalid_argument("bucket must be within 0-99");
    return bucket;
  }

  std::string name_;
  int64_t percent_;
  bool killed_ = false;
  std::set<int64_t> allowed_;
};
