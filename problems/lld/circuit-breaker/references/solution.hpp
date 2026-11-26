#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>

// Guards calls to a failing dependency. The breaker checks the time and hands every
// event to its current state object, which says what happens and what comes next.
class CircuitBreaker {
 public:
  CircuitBreaker(int64_t threshold, int64_t coolDownMs) : threshold_(threshold), coolDownMs_(coolDownMs) {
    if (threshold < 1 || threshold > kMaxThreshold || coolDownMs < 1 || coolDownMs > kMaxCoolDownMs)
      throw std::invalid_argument("bad threshold or cool-down");
  }

  bool allow(int64_t nowMs) { return at(nowMs).allow(); }

  void success(int64_t nowMs) { move(at(nowMs).success(*this, nowMs)); }

  void failure(int64_t nowMs) { move(at(nowMs).failure(*this, nowMs)); }

  std::string state(int64_t nowMs) { return at(nowMs).name(); }

  // The extension round: the manual override.
  void forceOpen(bool on) {
    move(state_->force(on));
  }

 private:
  static constexpr int64_t kMaxThreshold = 1000;
  static constexpr int64_t kMaxCoolDownMs = 1000000000;

  // One state's rules. Each event returns the state the breaker moves to, or null to
  // stay, so the breaker itself never asks which state it's in.
  struct State {
    virtual ~State() = default;
    virtual std::string name() const = 0;
    virtual std::unique_ptr<State> tick(const CircuitBreaker&, int64_t) { return nullptr; }
    virtual bool allow() { return false; }
    virtual std::unique_ptr<State> success(const CircuitBreaker&, int64_t) { return nullptr; }
    virtual std::unique_ptr<State> failure(const CircuitBreaker&, int64_t) { return nullptr; }
    virtual std::unique_ptr<State> force(bool on);
  };

  struct Open;
  struct HalfOpen;

  struct Closed : State {
    int64_t failures = 0;
    std::string name() const override { return "closed"; }
    bool allow() override { return true; }
    std::unique_ptr<State> success(const CircuitBreaker&, int64_t) override {
      failures = 0;
      return nullptr;
    }
    std::unique_ptr<State> failure(const CircuitBreaker& breaker, int64_t nowMs) override;
  };

  // Refuses every call until the cool-down has passed; outcomes of calls let through
  // earlier change nothing.
  struct Open : State {
    int64_t openedMs;
    explicit Open(int64_t opened) : openedMs(opened) {}
    std::string name() const override { return "open"; }
    std::unique_ptr<State> tick(const CircuitBreaker& breaker, int64_t nowMs) override;
  };

  // Lets one trial call through; only that call's outcome decides what comes next.
  struct HalfOpen : State {
    bool trial = false;
    std::string name() const override { return "half-open"; }
    bool allow() override {
      bool allowed = !trial;
      trial = true;
      return allowed;
    }
    std::unique_ptr<State> success(const CircuitBreaker&, int64_t) override {
      return trial ? std::make_unique<Closed>() : nullptr;
    }
    std::unique_ptr<State> failure(const CircuitBreaker&, int64_t nowMs) override {
      return trial ? std::make_unique<Open>(nowMs) : nullptr;
    }
  };

  // The manual override: open, with no cool-down, until it's released.
  struct ForcedOpen : State {
    std::string name() const override { return "open"; }
    std::unique_ptr<State> force(bool on) override { return on ? nullptr : std::make_unique<Closed>(); }
  };

  void move(std::unique_ptr<State> next) {
    if (next) state_ = std::move(next);
  }

  State& at(int64_t nowMs) {
    if (nowMs < lastMs_) throw std::invalid_argument("time went backwards");
    lastMs_ = nowMs;
    move(state_->tick(*this, nowMs));
    return *state_;
  }

  int64_t threshold_;
  int64_t coolDownMs_;
  std::unique_ptr<State> state_ = std::make_unique<Closed>();
  int64_t lastMs_ = 0;
};

inline std::unique_ptr<CircuitBreaker::State> CircuitBreaker::Closed::failure(const CircuitBreaker& breaker,
                                                                              int64_t nowMs) {
  failures += 1;
  return failures >= breaker.threshold_ ? std::make_unique<Open>(nowMs) : nullptr;
}

inline std::unique_ptr<CircuitBreaker::State> CircuitBreaker::Open::tick(const CircuitBreaker& breaker,
                                                                         int64_t nowMs) {
  return nowMs >= openedMs + breaker.coolDownMs_ ? std::make_unique<HalfOpen>() : nullptr;
}

inline std::unique_ptr<CircuitBreaker::State> CircuitBreaker::State::force(bool on) {
  return on ? std::make_unique<ForcedOpen>() : nullptr;
}
