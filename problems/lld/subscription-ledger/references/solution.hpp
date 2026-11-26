#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// A subscription at one moment. Copied by value, so a snapshot (a memento) can't change
// later; an empty optional stands for a subscription not created yet.
struct SubState {
  std::string status;
  int64_t tier;
  int64_t pausedUntil;
};

using MaybeState = std::optional<SubState>;

struct SubEvent {
  int64_t at;
  std::string name;
  int64_t arg;
};

class SubscriptionLedger {
 public:
  SubscriptionLedger() {
    for (const auto& [kind, unused] : apply()) kinds_[kind] = kind;
  }

  bool handle(std::string command, std::string sub, int64_t arg, int64_t nowMs) {
    auto found = commands().find(command);
    if (found == commands().end() || sub.empty() || !found->second.valid(arg))
      throw std::invalid_argument("an unknown command, an empty sub or a bad arg");
    if (nowMs < last_ || nowMs > kMaxMs) throw std::invalid_argument("time runs forward, up to 10^12");
    last_ = nowMs;
    const Command& c = found->second;
    Stream& stream = streams_[sub];
    if (!c.allowed(stream.current, arg, nowMs)) return false;
    SubEvent event{nowMs, nameOf(c.kind), arg};
    stream.events.push_back(event);
    SubState state = apply().at(c.kind)(stream.current, event);
    stream.current = state;
    if (every_ && stream.events.size() % *every_ == 0) stream.snapshots.push_back({stream.events.size(), state});
    return true;
  }

  std::vector<std::string> events(std::string sub) {
    std::vector<std::string> out;
    for (const SubEvent& e : stream(sub).events)
      out.push_back(std::to_string(e.at) + ":" + read(e.name) + ":" + std::to_string(e.arg));
    return out;
  }

  std::string stateAt(std::string sub, int64_t nowMs) {
    const Stream& s = stream(sub);
    if (nowMs < 0 || nowMs > kMaxMs) throw std::invalid_argument("a time runs from 0 to 10^12");
    size_t covered = 0;
    MaybeState state;
    for (const auto& [count, snapshot] : s.snapshots) {
      if (s.events[count - 1].at <= nowMs) {
        covered = count;
        state = snapshot;
      }
    }
    for (size_t i = covered; i < s.events.size(); i++) {
      const SubEvent& event = s.events[i];
      if (event.at > nowMs) break;
      state = apply().at(kinds_.at(read(event.name)))(state, event);
      replayed_++;
    }
    return shown(state, nowMs);
  }

  void snapshotEvery(int64_t n) {
    if (n < 1 || n > 10000) throw std::invalid_argument("n runs from 1 to 10^4");
    every_ = static_cast<size_t>(n);
  }

  int64_t replays() { return replayed_; }

  // The extension round: old events read under a new schema name.
  void upcast(std::string eventName, std::string newName) {
    auto kind = kinds_.find(eventName);
    bool ok = !newName.empty();
    for (char c : newName) ok = ok && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'));
    if (kind == kinds_.end() || !ok) throw std::invalid_argument("not a current name, or a bad new name");
    if (kinds_.count(newName) || renamed_.count(newName)) throw std::invalid_argument("a name is never used twice");
    std::string k = kind->second;
    renamed_[eventName] = newName;
    kinds_.erase(eventName);
    kinds_[newName] = k;
  }

 private:
  static constexpr int64_t kMaxTier = 100;
  static constexpr int64_t kMaxPauseMs = 1'000'000'000;
  static constexpr int64_t kMaxMs = 1'000'000'000'000;

  using Apply = std::function<SubState(const MaybeState&, const SubEvent&)>;
  using Rule = std::function<bool(const MaybeState&, int64_t, int64_t)>;

  static std::string shown(const MaybeState& state, int64_t now) {
    if (!state) return "none";
    if (state->status == "active" && now < state->pausedUntil) return "paused:" + std::to_string(state->tier);
    return state->status + ":" + std::to_string(state->tier);
  }

  static const SubState& present(const MaybeState& s) {
    if (!s) throw std::logic_error("only created comes first");
    return *s;
  }

  // What each event does to a state, by its kind.
  static const std::map<std::string, Apply>& apply() {
    static const std::map<std::string, Apply> table{
        {"created", [](const MaybeState&, const SubEvent& e) { return SubState{"active", e.arg, e.at}; }},
        {"upgraded",
         [](const MaybeState& s, const SubEvent& e) {
           SubState next = present(s);
           next.tier = e.arg;
           return next;
         }},
        {"paused",
         [](const MaybeState& s, const SubEvent& e) {
           SubState next = present(s);
           next.pausedUntil = e.at + e.arg;
           return next;
         }},
        {"cancelled",
         [](const MaybeState& s, const SubEvent&) {
           SubState next = present(s);
           next.status = "cancelled";
           return next;
         }},
    };
    return table;
  }

  static bool running(const MaybeState& s, int64_t now) { return shown(s, now).rfind("active:", 0) == 0; }

  // A request: its argument's range, and the rule it's checked by against the current
  // state. If it's allowed, it becomes an event of `kind`.
  struct Command {
    std::string kind;
    int64_t low;
    int64_t high;
    Rule allowed;

    bool valid(int64_t arg) const { return low <= arg && arg <= high; }
  };

  static const std::map<std::string, Command>& commands() {
    static const std::map<std::string, Command> table{
        {"create", {"created", 1, kMaxTier, [](const MaybeState& s, int64_t, int64_t) { return !s; }}},
        {"upgrade",
         {"upgraded", 1, kMaxTier,
          [](const MaybeState& s, int64_t arg, int64_t now) { return running(s, now) && s && arg > s->tier; }}},
        {"pause", {"paused", 1, kMaxPauseMs, [](const MaybeState& s, int64_t, int64_t now) { return running(s, now); }}},
        {"cancel",
         {"cancelled", 0, 0, [](const MaybeState& s, int64_t, int64_t) { return s && s->status == "active"; }}},
    };
    return table;
  }

  // One subscription's events, its current state, and snapshots: (events covered, state
  // after them).
  struct Stream {
    std::vector<SubEvent> events;
    MaybeState current;
    std::vector<std::pair<size_t, SubState>> snapshots;
  };

  std::string nameOf(const std::string& kind) const {
    for (const auto& [name, k] : kinds_)
      if (k == kind) return name;
    throw std::logic_error("every kind has a name");
  }

  std::string read(std::string name) const {
    // Each name is renamed at most once and never reused, so this ends.
    for (size_t i = 0; i < renamed_.size(); i++) {
      auto found = renamed_.find(name);
      if (found != renamed_.end()) name = found->second;
    }
    return name;
  }

  const Stream& stream(const std::string& sub) {
    if (sub.empty()) throw std::invalid_argument("an empty sub");
    static const Stream none;
    auto found = streams_.find(sub);
    return found == streams_.end() ? none : found->second;
  }

  std::map<std::string, Stream> streams_;
  std::optional<size_t> every_;
  int64_t replayed_ = 0;
  int64_t last_ = 0;
  // An upcaster: an old event name and the newer name it's read under.
  std::map<std::string, std::string> renamed_;
  std::map<std::string, std::string> kinds_;  // current name -> kind
};
