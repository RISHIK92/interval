#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

class TaskScheduler {
 public:
  void add(std::string id, int64_t priority, std::vector<std::string> deps) {
    std::lock_guard<std::mutex> hold(mu_);
    if (tasks_.count(id)) throw std::invalid_argument("duplicate id");
    for (const auto& d : deps)
      if (!tasks_.count(d)) throw std::invalid_argument("unknown dependency");
    tasks_[id] = Task{priority, deps, "queued"};
    order_.push_back(id);
  }

  std::optional<std::string> next() {
    std::lock_guard<std::mutex> hold(mu_);
    const std::string* best = nullptr;
    for (const auto& id : order_) {
      // Strictly greater, so the earliest added keeps a tie.
      if (ready(tasks_[id]) && (best == nullptr || tasks_[id].priority > tasks_[*best].priority))
        best = &id;
    }
    if (best == nullptr) return std::nullopt;
    tasks_[*best].state = "running";
    return *best;
  }

  void complete(std::string id) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = tasks_.find(id);
    if (it == tasks_.end() || it->second.state != "running")
      throw std::invalid_argument("not running");
    it->second.state = "done";
  }

  std::string status(std::string id) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = tasks_.find(id);
    if (it == tasks_.end()) throw std::invalid_argument("unknown id");
    if (it->second.state == "queued") return ready(it->second) ? "ready" : "waiting";
    return it->second.state;
  }

  // The extension round.
  int64_t cancel(std::string id) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = tasks_.find(id);
    if (it == tasks_.end()) throw std::invalid_argument("unknown id");
    if (it->second.state == "done") throw std::invalid_argument("already done");
    if (it->second.state == "cancelled") return 0;
    // Dependencies are always added first, so one pass in order finds every dependent.
    std::set<std::string> gone{id};
    it->second.state = "cancelled";
    for (const auto& other : order_) {
      Task& t = tasks_[other];
      if (t.state != "queued") continue;
      for (const auto& d : t.deps)
        if (gone.count(d)) {
          t.state = "cancelled";
          gone.insert(other);
          break;
        }
    }
    return static_cast<int64_t>(gone.size());
  }

 private:
  struct Task {
    int64_t priority;
    std::vector<std::string> deps;
    // queued, running, done or cancelled.
    std::string state;
  };

  bool ready(const Task& t) {
    if (t.state != "queued") return false;
    for (const auto& d : t.deps)
      if (tasks_[d].state != "done") return false;
    return true;
  }

  std::map<std::string, Task> tasks_;
  // Ids in the order they were added, which breaks priority ties.
  std::vector<std::string> order_;
  std::mutex mu_;
};
