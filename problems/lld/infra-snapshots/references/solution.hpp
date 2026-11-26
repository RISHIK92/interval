#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using Resources = std::map<std::string, std::map<std::string, std::string>>;

// The memento: a frozen copy of the state that only InfraState reads back. std::map copies
// deeply, so holding it by value is the copy.
class Snapshot {
 public:
  Snapshot(std::string label, Resources resources) : label(std::move(label)), saved_(std::move(resources)) {}

  Resources resources() const { return saved_; }

  const std::string label;

 private:
  const Resources saved_;
};

class InfraState {
 public:
  void apply(std::string resource, std::map<std::string, std::string> attrs) {
    bool empty = resource.empty();
    for (const auto& [k, v] : attrs) empty = empty || k.empty() || v.empty();
    if (empty) throw std::invalid_argument("empty name or value");
    current_[resource] = attrs;
  }

  bool destroy(std::string resource) {
    if (resource.empty()) throw std::invalid_argument("empty resource");
    return current_.erase(resource) > 0;
  }

  int64_t snapshot(std::string label) {
    if (label.empty()) throw std::invalid_argument("empty label");
    for (auto it = snapshots_.begin(); it != snapshots_.end();)
      it = it->second.label == label ? snapshots_.erase(it) : std::next(it);
    lastId_ += 1;
    snapshots_.emplace(lastId_, Snapshot(label, current_));
    return lastId_;
  }

  bool restore(int64_t snapshotId) {
    auto snap = snapshots_.find(snapshotId);
    if (snap == snapshots_.end()) return false;
    current_ = snap->second.resources();
    return true;
  }

  std::vector<std::string> diffSince(int64_t snapshotId) {
    auto snap = snapshots_.find(snapshotId);
    if (snap == snapshots_.end()) throw std::invalid_argument("unknown snapshot");
    Resources then = snap->second.resources();
    std::set<std::string> names;
    for (const auto& [name, attrs] : then) names.insert(name);
    for (const auto& [name, attrs] : current_) names.insert(name);
    std::vector<std::string> out;
    for (const auto& name : names) {
      auto before = then.find(name), now = current_.find(name);
      if (before == then.end()) {
        out.push_back("+ " + name);
      } else if (now == current_.end()) {
        out.push_back("- " + name);
      } else {
        std::set<std::string> keys;
        for (const auto& [k, v] : before->second) keys.insert(k);
        for (const auto& [k, v] : now->second) keys.insert(k);
        std::string changed;
        for (const auto& k : keys) {
          auto a = before->second.find(k), b = now->second.find(k);
          bool same = a != before->second.end() && b != now->second.end() && a->second == b->second;
          if (!same) changed += (changed.empty() ? "" : ",") + k;
        }
        if (!changed.empty()) out.push_back("~ " + name + ": " + changed);
      }
    }
    return out;
  }

  // The extension round: keeping only the newest snapshots.
  int64_t prune(int64_t keep) {
    if (keep < 0) throw std::invalid_argument("negative keep");
    int64_t dropped = std::max<int64_t>(static_cast<int64_t>(snapshots_.size()) - keep, 0);
    for (int64_t i = 0; i < dropped; i++) snapshots_.erase(snapshots_.begin());
    return dropped;
  }

 private:
  Resources current_;
  // The caretaker's side: snapshots by id, known here only by their labels.
  std::map<int64_t, Snapshot> snapshots_;
  int64_t lastId_ = 0;
};
