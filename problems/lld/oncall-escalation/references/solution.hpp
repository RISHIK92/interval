#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// One link in the chain: its person is paged in turn, and when they don't acknowledge in
// time the page moves on to the next link, if there is one.
struct Level {
  std::string person;
  std::shared_ptr<const Level> after;
};

class Escalation {
 public:
  Escalation(std::vector<std::string> levels, int64_t ackTimeoutMs)
      : people_(levels.begin(), levels.end()), timeout_(ackTimeoutMs) {
    if (levels.empty() || people_.count("") > 0 || people_.size() != levels.size() || ackTimeoutMs < 1)
      throw std::invalid_argument("bad levels or timeout");
    for (auto it = levels.rbegin(); it != levels.rend(); ++it)
      first_ = std::make_shared<const Level>(Level{*it, first_});
  }

  std::string page(std::string incident, int64_t nowMs) {
    if (incident.empty() || incidents_.count(incident) > 0)
      throw std::invalid_argument("an empty or known incident");
    clock(nowMs);
    std::string holder = paged(*first_);
    incidents_[incident] = Incident{first_, holder, nowMs, false};
    return holder;
  }

  std::vector<std::string> tick(int64_t nowMs) {
    clock(nowMs);
    std::vector<std::string> moved;
    for (auto& [name, incident] : incidents_) {
      auto after = incident.level->after;
      if (incident.acked || after == nullptr || nowMs - incident.since < timeout_) continue;
      incident.level = after;
      incident.holder = paged(*after);
      incident.since = nowMs;
      moved.push_back(name + " -> " + incident.holder);
    }
    return moved;
  }

  bool ack(std::string incident, std::string person, int64_t nowMs) {
    if (incident.empty() || person.empty()) throw std::invalid_argument("an empty name");
    clock(nowMs);
    auto found = incidents_.find(incident);
    if (found == incidents_.end() || found->second.acked || found->second.holder != person) return false;
    found->second.acked = true;
    return true;
  }

  std::optional<std::string> holder(std::string incident) {
    if (incident.empty()) throw std::invalid_argument("an empty incident");
    auto found = incidents_.find(incident);
    if (found == incidents_.end()) return std::nullopt;
    return found->second.holder;
  }

  // The extension round: holiday cover, applied whenever someone is paged from now on.
  void cover(std::string person, std::string substitute) {
    if (people_.count(person) == 0 || substitute.empty())
      throw std::invalid_argument("not on call, or an empty substitute");
    if (substitute == person)
      covers_.erase(person);
    else
      covers_[person] = substitute;
  }

 private:
  struct Incident {
    std::shared_ptr<const Level> level;
    std::string holder;
    int64_t since;
    bool acked;
  };

  void clock(int64_t nowMs) {
    if (nowMs < now_) throw std::invalid_argument("time went backwards");
    now_ = nowMs;
  }

  std::string paged(const Level& level) const {
    auto found = covers_.find(level.person);
    return found == covers_.end() ? level.person : found->second;
  }

  std::set<std::string> people_;
  int64_t timeout_;
  std::shared_ptr<const Level> first_;
  std::map<std::string, Incident> incidents_;
  std::map<std::string, std::string> covers_;
  int64_t now_ = 0;
};
