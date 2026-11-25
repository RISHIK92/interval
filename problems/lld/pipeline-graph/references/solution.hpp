#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// The pipeline owns stages, a stage owns its jobs (composition); a job only names the
// jobs it needs (dependency), all in earlier stages, so a run goes in stage order.
class Pipeline {
 public:
  Pipeline() {}

  void stage(std::string name) {
    named(name);
    if (jobs_.count(name) > 0) throw std::invalid_argument("stage already exists");
    stages_.push_back(name);
    jobs_[name];
  }

  bool job(std::string stage, std::string name, std::vector<std::string> needs) {
    named(stage);
    named(name);
    for (const auto& n : needs) named(n);
    if (jobs_.count(stage) == 0) throw std::invalid_argument("unknown stage");
    if (std::set<std::string>(needs.begin(), needs.end()).size() != needs.size())
      throw std::invalid_argument("a need is listed twice");
    if (stageOf_.count(name) > 0) return false;
    auto end = std::find(stages_.begin(), stages_.end(), stage);
    for (const auto& n : needs) {
      auto it = stageOf_.find(n);
      if (it == stageOf_.end() || std::find(stages_.begin(), end, it->second) == end) return false;
    }
    jobs_[stage].push_back(name);
    stageOf_[name] = stage;
    needs_[name] = needs;
    return true;
  }

  void fail(std::string job) {
    known(job);
    failing_.insert(job);
  }

  std::vector<std::string> run() {
    std::map<std::string, std::string> outcome;
    std::vector<std::string> out;
    for (const auto& stage : stages_)
      for (const auto& job : jobs_[stage]) {
        std::string result = failing_.count(job) > 0 ? "failed" : "passed";
        for (const auto& n : needs_[job])
          if (blocks(n, outcome[n])) result = "skipped";
        outcome[job] = result;
        out.push_back(job + ": " + result);
      }
    return out;
  }

  int64_t removeStage(std::string name) {
    named(name);
    auto it = jobs_.find(name);
    if (it == jobs_.end()) throw std::invalid_argument("unknown stage");
    std::set<std::string> owned(it->second.begin(), it->second.end());
    for (const auto& [job, needs] : needs_)
      if (owned.count(job) == 0)
        for (const auto& n : needs)
          if (owned.count(n) > 0) throw std::invalid_argument("a later job needs this stage");
    for (const auto& job : owned) {
      stageOf_.erase(job);
      needs_.erase(job);
      failing_.erase(job);
      allowed_.erase(job);
    }
    stages_.erase(std::find(stages_.begin(), stages_.end(), name));
    jobs_.erase(it);
    return static_cast<int64_t>(owned.size());
  }

  // The extension round: an allowed failure doesn't skip the jobs that need it.
  void allowFailure(std::string job) {
    known(job);
    allowed_.insert(job);
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("stage and job names are not empty");
  }

  void known(const std::string& job) {
    named(job);
    if (stageOf_.count(job) == 0) throw std::invalid_argument("unknown job");
  }

  bool blocks(const std::string& need, const std::string& result) {
    return result == "skipped" || (result == "failed" && allowed_.count(need) == 0);
  }

  std::vector<std::string> stages_;
  std::map<std::string, std::vector<std::string>> jobs_;
  std::map<std::string, std::string> stageOf_;
  std::map<std::string, std::vector<std::string>> needs_;
  std::set<std::string> failing_;
  std::set<std::string> allowed_;
};
