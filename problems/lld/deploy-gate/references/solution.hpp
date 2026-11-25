#pragma once
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Callers tell the gate what happened and ask it one question, "may I deploy?". Which
// checks are required, what they last reported and which are waived stay inside.
class DeployGate {
 public:
  DeployGate() {}

  void require(std::string check) {
    named(check);
    required_.insert(check);
  }

  void report(std::string check, bool passed) {
    named(check);
    passed_[check] = passed;
  }

  bool mayDeploy() {
    for (const auto& c : required_)
      if (blocks(c)) return false;
    return true;
  }

  std::vector<std::string> blockers() {
    std::vector<std::string> out;
    for (const auto& c : required_)
      if (blocks(c)) out.push_back(c);
    return out;
  }

  // The extension round: a waived check never blocks.
  void waive(std::string check, std::string reason) {
    named(check);
    if (reason.empty()) throw std::invalid_argument("a waiver has a reason");
    if (required_.count(check) == 0) throw std::invalid_argument("only a required check is waived");
    waived_[check] = reason;
  }

  std::vector<std::string> waivers() {
    std::vector<std::string> out;
    for (const auto& [c, reason] : waived_) out.push_back(c + ": " + reason);
    return out;
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("check names are not empty");
  }

  bool blocks(const std::string& check) const {
    if (waived_.count(check) > 0) return false;
    auto last = passed_.find(check);
    return last == passed_.end() || !last->second;
  }

  std::set<std::string> required_;
  std::map<std::string, bool> passed_;  // each check's latest report
  std::map<std::string, std::string> waived_;  // check -> reason
};
