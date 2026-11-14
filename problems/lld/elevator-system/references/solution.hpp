#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

class ElevatorSystem {
 public:
  ElevatorSystem(int64_t elevators, int64_t floors) {
    if (elevators < 1 || floors < 1) throw std::invalid_argument("need an elevator and a floor");
    top_ = floors;
    at_.assign(elevators, 0);
    stops_.assign(elevators, {});
    out_.assign(elevators, false);
  }

  int64_t request(int64_t floor) {
    checkFloor(floor);
    std::lock_guard<std::mutex> hold(mu_);
    return dispatch(floor);
  }

  bool press(int64_t elevator, int64_t floor) {
    checkElevator(elevator);
    checkFloor(floor);
    std::lock_guard<std::mutex> hold(mu_);
    if (out_[elevator]) throw std::runtime_error("out of service");
    return stops_[elevator].insert(floor).second;
  }

  std::vector<std::string> step() {
    std::lock_guard<std::mutex> hold(mu_);
    std::vector<std::string> opened;
    for (size_t i = 0; i < at_.size(); i++) {
      if (stops_[i].empty()) continue;
      int64_t target = targetOf(i);
      if (target > at_[i]) at_[i]++;
      else if (target < at_[i]) at_[i]--;
      if (stops_[i].erase(at_[i]) > 0) opened.push_back(std::to_string(i) + ":" + std::to_string(at_[i]));
    }
    return opened;
  }

  std::string status(int64_t elevator) {
    checkElevator(elevator);
    std::lock_guard<std::mutex> hold(mu_);
    int64_t here = at_[elevator];
    if (out_[elevator]) return std::to_string(here) + " out -";
    if (stops_[elevator].empty()) return std::to_string(here) + " idle -";
    int64_t target = targetOf(elevator);
    std::string state = target == here ? "here" : target > here ? "up" : "down";
    std::string list;
    for (int64_t s : stops_[elevator]) list += (list.empty() ? "" : ",") + std::to_string(s);
    return std::to_string(here) + " " + state + " " + list;
  }

  bool outOfService(int64_t elevator) {
    checkElevator(elevator);
    std::lock_guard<std::mutex> hold(mu_);
    if (out_[elevator]) return false;
    if (std::count(out_.begin(), out_.end(), false) == 1) throw std::runtime_error("last elevator in service");
    out_[elevator] = true;
    std::set<int64_t> pending;
    pending.swap(stops_[elevator]);
    for (int64_t floor : pending) dispatch(floor);
    return true;
  }

 private:
  void checkElevator(int64_t e) const {
    if (e < 0 || e >= static_cast<int64_t>(at_.size())) throw std::invalid_argument("unknown elevator");
  }

  void checkFloor(int64_t f) const {
    if (f < 0 || f > top_) throw std::invalid_argument("unknown floor");
  }

  // The stops are ordered, so the first nearest one is the lower on a tie.
  int64_t targetOf(size_t i) const {
    int64_t best = *stops_[i].begin();
    for (int64_t s : stops_[i])
      if (std::llabs(s - at_[i]) < std::llabs(best - at_[i])) best = s;
    return best;
  }

  // Callers hold the lock.
  int64_t dispatch(int64_t floor) {
    int64_t best = -1;
    int64_t bestCost = 0;
    for (size_t i = 0; i < at_.size(); i++) {
      if (out_[i]) continue;
      if (stops_[i].count(floor)) return static_cast<int64_t>(i);
      int64_t cost = std::llabs(at_[i] - floor) + static_cast<int64_t>(stops_[i].size());
      if (best == -1 || cost < bestCost) {
        best = static_cast<int64_t>(i);
        bestCost = cost;
      }
    }
    stops_[best].insert(floor);
    return best;
  }

  int64_t top_ = 0;
  std::vector<int64_t> at_;
  std::vector<std::set<int64_t>> stops_;
  // The extension round: elevators out of service.
  std::vector<bool> out_;
  std::mutex mu_;
};
