#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// The one thing that varies between schedules: the delay before an attempt, at most
// `cap`. Growth stops at the cap, so no kind ever overflows.
class Growth {
 public:
  virtual ~Growth() = default;
  virtual int64_t delay(int64_t attempt, int64_t base, int64_t cap) const = 0;
};

class FixedGrowth : public Growth {
 public:
  int64_t delay(int64_t, int64_t base, int64_t) const override { return base; }
};

class LinearGrowth : public Growth {
 public:
  int64_t delay(int64_t attempt, int64_t base, int64_t cap) const override {
    return std::min(base * attempt, cap);
  }
};

class ExponentialGrowth : public Growth {
 public:
  int64_t delay(int64_t attempt, int64_t base, int64_t cap) const override {
    int64_t d = base;
    for (int64_t a = 1; a < attempt && d < cap; a++) d *= 2;
    return std::min(d, cap);
  }
};

class FibonacciGrowth : public Growth {
 public:
  int64_t delay(int64_t attempt, int64_t base, int64_t cap) const override {
    int64_t previous = 0, current = base;
    for (int64_t a = 1; a < attempt && current < cap; a++) {
      int64_t next = previous + current;
      previous = current;
      current = next;
    }
    return std::min(current, cap);
  }
};

// Caps, schedules and totals are the same for every kind; only the growth is swapped.
class BackoffSchedule {
 public:
  BackoffSchedule(std::string kind, int64_t baseMs, int64_t capMs)
      : growth_(growthOf(kind)), base_(baseMs), cap_(capMs) {
    if (baseMs < 1 || capMs < baseMs || capMs > kMaxCapMs)
      throw std::invalid_argument("1 <= baseMs <= capMs <= 10^9");
  }

  int64_t delay(int64_t attempt) {
    count(attempt, 1);
    return growth_->delay(attempt, base_, cap_);
  }

  std::vector<int64_t> schedule(int64_t attempts) {
    count(attempts, 0);
    std::vector<int64_t> out;
    for (int64_t a = 1; a <= attempts; a++) out.push_back(delay(a));
    return out;
  }

  int64_t totalMs(int64_t attempts) {
    int64_t sum = 0;
    for (int64_t d : schedule(attempts)) sum += d;
    return sum;
  }

  void switchTo(std::string kind) { growth_ = growthOf(kind); }

  // The extension round: one more growth, and nothing else changes.
  void fibonacci() { growth_ = std::make_shared<FibonacciGrowth>(); }

 private:
  static constexpr int64_t kMaxAttempts = 1000;
  static constexpr int64_t kMaxCapMs = 1000000000;

  static std::shared_ptr<const Growth> growthOf(const std::string& kind) {
    if (kind == "fixed") return std::make_shared<FixedGrowth>();
    if (kind == "linear") return std::make_shared<LinearGrowth>();
    if (kind == "exponential") return std::make_shared<ExponentialGrowth>();
    throw std::invalid_argument("unknown kind");
  }

  static void count(int64_t n, int64_t low) {
    if (n < low || n > kMaxAttempts) throw std::invalid_argument("attempts out of range");
  }

  std::shared_ptr<const Growth> growth_;
  int64_t base_;
  int64_t cap_;
};
