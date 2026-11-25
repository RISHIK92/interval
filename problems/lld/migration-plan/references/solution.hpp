#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Invariant: the applied migrations are exactly the lowest `applied_` versions, so the
// current version is the last of them and everything above it is pending.
class MigrationPlan {
 public:
  MigrationPlan() {}

  void add(int64_t version, std::string name) {
    precondition(version >= 1 && version <= 1000000000, "versions are within 1 and 10^9");
    precondition(!name.empty(), "a migration has a name");
    precondition(names_.count(version) == 0, "that version is already planned");
    // It must land above every applied migration, or it could never be applied.
    precondition(version > current(), "that version is below the current one");
    names_[version] = name;
    versions_.insert(std::upper_bound(versions_.begin(), versions_.end(), version), version);
  }

  std::vector<std::string> applyUpTo(int64_t version) {
    precondition(names_.count(version) > 0, "unknown version");
    precondition(version >= current(), "applying never goes down");
    size_t start = applied_;
    applied_ = std::upper_bound(versions_.begin(), versions_.end(), version) - versions_.begin();
    std::vector<std::string> out;
    for (size_t i = start; i < applied_; i++) out.push_back(names_[versions_[i]]);
    return out;
  }

  std::vector<std::string> rollback(int64_t steps) {
    precondition(steps >= 1 && steps <= static_cast<int64_t>(applied_), "steps are within 1 and the applied count");
    std::vector<int64_t> undone(versions_.rbegin() + (versions_.size() - applied_),
                                versions_.rbegin() + (versions_.size() - applied_ + steps));
    for (int64_t v : undone) precondition(locked_.count(v) == 0, "an irreversible migration is in the way");
    applied_ -= steps;
    std::vector<std::string> out;
    for (int64_t v : undone) out.push_back(names_[v]);
    return out;
  }

  int64_t current() { return applied_ > 0 ? versions_[applied_ - 1] : 0; }

  std::vector<int64_t> pending() { return {versions_.begin() + applied_, versions_.end()}; }

  // The extension round: one more precondition on rollback.
  void irreversible(int64_t version) {
    precondition(names_.count(version) > 0, "unknown version");
    locked_.insert(version);
  }

 private:
  // A broken precondition fails the call before anything changes.
  static void precondition(bool condition, const char* why) {
    if (!condition) throw std::logic_error(why);
  }

  std::map<int64_t, std::string> names_;
  std::vector<int64_t> versions_;
  size_t applied_ = 0;
  std::set<int64_t> locked_;
};
