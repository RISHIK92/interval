#pragma once
#include <algorithm>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A colleague: it knows its own changes and sign-offs, never the other trains.
class Train {
 public:
  Train(std::string name, bool hotfix) : name(std::move(name)), hotfix(hotfix) {}

  bool ready() const { return signed_.count("security") && (hotfix || signed_.count("qa")); }

  bool needs(const std::string& role) const { return role == "security" || !hotfix; }

  bool hasSigned(const std::string& role) const { return signed_.count(role) > 0; }

  void sign(const std::string& role) { signed_.insert(role); }

  void take(const std::string& change, const std::string& team) {
    changes.emplace_back(change, team);
    signed_.clear();
  }

  std::string drop(const std::string& change) {
    auto at = std::find_if(changes.begin(), changes.end(), [&](const auto& c) { return c.first == change; });
    std::string team = at->second;
    changes.erase(at);
    signed_.clear();
    return team;
  }

  const std::string name;
  const bool hotfix;
  std::vector<std::pair<std::string, std::string>> changes;  // change and team, in boarding order
  bool departed = false;

 private:
  std::set<std::string> signed_;
};

// The mediator: teams, reviewers and trains only talk to it, and it keeps the rule that
// any change to a train's contents voids its sign-offs.
class ReleaseTrain {
 public:
  std::string board(std::string team, std::string change) {
    if (team.empty() || change.empty()) throw std::invalid_argument("empty name");
    if (aboard_.count(change) || departed_.count(change)) throw std::invalid_argument("the change has boarded");
    Train* train = nullptr;
    for (auto& t : trains_)
      if (!t->departed && !t->hotfix && !t->ready()) {
        train = t.get();
        break;
      }
    if (train == nullptr) train = newTrain(false);
    train->take(change, team);
    aboard_[change] = train;
    return train->name;
  }

  bool signOff(std::string role, std::string train) {
    if (role != "qa" && role != "security") throw std::invalid_argument("unknown role");
    Train* t = find(train);
    if (t->departed || t->changes.empty() || !t->needs(role) || t->hasSigned(role)) return false;
    t->sign(role);
    return true;
  }

  bool pull(std::string change) {
    if (change.empty()) throw std::invalid_argument("empty change");
    auto at = aboard_.find(change);
    if (at == aboard_.end()) return false;
    at->second->drop(change);
    aboard_.erase(at);
    return true;
  }

  std::vector<std::string> depart(std::string train) {
    Train* t = find(train);
    if (t->departed || !t->ready()) return {};
    t->departed = true;
    std::vector<std::string> out;
    for (const auto& [change, team] : t->changes) {
      aboard_.erase(change);
      departed_.insert(change);
      out.push_back(team + ":" + change);
    }
    return out;
  }

  // The extension round: a hotfix leaves its train and departs alone.
  std::string hotfix(std::string change) {
    auto at = aboard_.find(change);
    if (at == aboard_.end() || at->second->hotfix) throw std::invalid_argument("not aboard a regular train");
    Train* alone = newTrain(true);
    alone->take(change, at->second->drop(change));
    at->second = alone;
    return alone->name;
  }

 private:
  Train* newTrain(bool hotfix) {
    trains_.push_back(std::make_unique<Train>("T" + std::to_string(trains_.size() + 1), hotfix));
    return trains_.back().get();
  }

  Train* find(const std::string& name) {
    for (auto& t : trains_)
      if (t->name == name) return t.get();
    throw std::invalid_argument("unknown train");
  }

  std::vector<std::unique_ptr<Train>> trains_;
  std::map<std::string, Train*> aboard_;
  std::set<std::string> departed_;
};
