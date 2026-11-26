#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>

constexpr double kAdvanceBelow = 1.0;
constexpr double kAbortAbove = 5.0;
constexpr double kMaxRate = 100.0;

// One state of the rollout. Each move returns the next state, or null when this state
// doesn't allow it, so every state lists only its own moves.
class State : public std::enable_shared_from_this<State> {
 public:
  State(std::string name, int64_t percent) : name(std::move(name)), percent(percent) {}
  virtual ~State() = default;
  virtual std::shared_ptr<State> begin() { return nullptr; }
  virtual std::shared_ptr<State> advance() { return nullptr; }
  virtual std::shared_ptr<State> pause() { return nullptr; }
  virtual std::shared_ptr<State> resume() { return nullptr; }
  virtual std::shared_ptr<State> abort() { return nullptr; }

  const std::string name;
  const int64_t percent;
};

class Paused : public State {
 public:
  explicit Paused(std::shared_ptr<State> was) : State("paused", was->percent), was_(std::move(was)) {}
  std::shared_ptr<State> resume() override { return was_; }

 private:
  std::shared_ptr<State> was_;
};

// Canary and rolling share their moves: on, pause and abort.
class Moving : public State {
 public:
  Moving(std::string name, int64_t percent, std::shared_ptr<State> after)
      : State(std::move(name), percent), after_(std::move(after)) {}
  std::shared_ptr<State> advance() override { return after_; }
  std::shared_ptr<State> pause() override { return std::make_shared<Paused>(shared_from_this()); }
  std::shared_ptr<State> abort() override { return std::make_shared<State>("rolled-back", 0); }

 private:
  std::shared_ptr<State> after_;
};

class Pending : public State {
 public:
  Pending() : State("pending", 0) {}
  std::shared_ptr<State> begin() override {
    auto done = std::make_shared<State>("done", 100);
    return std::make_shared<Moving>("canary", 10, std::make_shared<Moving>("rolling", 50, done));
  }
};

class Rollout {
 public:
  explicit Rollout(std::string service) : service_(std::move(service)), state_(std::make_shared<Pending>()) {
    if (service_.empty()) throw std::invalid_argument("an empty service");
  }

  bool begin(std::string version) {
    if (version.empty()) throw std::invalid_argument("an empty version");
    auto to = state_->begin();
    if (to) version_ = version;
    return move(to);
  }

  bool advance() { return move(state_->advance()); }
  bool pause() { return move(state_->pause()); }
  bool resume() { return move(state_->resume()); }
  bool abort() { return move(state_->abort()); }

  std::string status() {
    if (version_.empty()) return service_ + " " + state_->name;
    return service_ + " " + state_->name + " " + version_ + " " + std::to_string(state_->percent) + "%";
  }

  // The extension round: the error rate decides the move.
  bool autoAdvance(double errorRate) {
    if (errorRate < 0 || errorRate > kMaxRate) throw std::invalid_argument("an error rate from 0 to 100");
    if (errorRate < kAdvanceBelow) return advance();
    if (errorRate > kAbortAbove) return abort();
    return false;
  }

 private:
  bool move(std::shared_ptr<State> to) {
    if (!to) return false;
    state_ = std::move(to);
    return true;
  }

  std::string service_;
  std::string version_;
  std::shared_ptr<State> state_;
};
