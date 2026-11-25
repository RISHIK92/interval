#pragma once
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

class Connection {
 public:
  Connection(std::string host) : host_(host) {
    if (host.empty()) throw std::invalid_argument("a connection needs a host");
  }

  bool connect() { return move(Action::Connect); }

  bool disconnect() { return move(Action::Disconnect); }

  void fail(std::string reason) {
    if (reason.empty()) throw std::invalid_argument("a failure needs a reason");
    move(Action::Fail);
  }

  std::string state() {
    switch (current_) {
      case State::Idle: return "idle";
      case State::Open: return "open";
      case State::Closed: return "closed";
      case State::Failed: return "failed";
    }
    return "";
  }

  // The extension round.
  bool reconnect() {
    bool moved = move(Action::Reconnect);
    if (moved) reopened_++;
    return moved;
  }

  int64_t attempts() { return reopened_; }

 private:
  enum class State { Idle, Open, Closed, Failed };
  enum class Action { Connect, Disconnect, Fail, Reconnect };

  bool move(Action action) {
    // Every legal move: (action, from) -> to. Anything else is refused.
    static const std::map<std::pair<Action, State>, State> moves = {
        {{Action::Connect, State::Idle}, State::Open},
        {{Action::Disconnect, State::Open}, State::Closed},
        {{Action::Fail, State::Idle}, State::Failed},
        {{Action::Fail, State::Open}, State::Failed},
        {{Action::Reconnect, State::Failed}, State::Open},
    };
    auto it = moves.find({action, current_});
    if (it == moves.end()) return false;
    current_ = it->second;
    return true;
  }

  std::string host_;
  State current_ = State::Idle;
  int64_t reopened_ = 0;
};
