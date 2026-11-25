#pragma once
#include <algorithm>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// There is deliberately no Runner interface with build, test, deploy and gpu methods, which
// would force a build-only runner to stub a deploy. A runner holds only the capabilities it
// really has, and a job is matched against just the ones it needs.
struct PoolRunner {
  std::string name;
  std::set<std::string> capabilities;
  std::optional<std::string> job;
  bool draining = false;

  bool takes(const std::set<std::string>& needs) const {
    return !job && !draining && std::includes(capabilities.begin(), capabilities.end(), needs.begin(), needs.end());
  }
};

class RunnerPool {
 public:
  RunnerPool() = default;

  void addRunner(std::string name, std::vector<std::string> capabilities) {
    given(name);
    if (find(name) != runners_.end()) throw std::invalid_argument("runner already in the pool");
    runners_.push_back(PoolRunner{name, known(capabilities), std::nullopt});
  }

  std::optional<std::string> assign(std::string job, std::vector<std::string> needs) {
    given(job);
    auto wanted = known(needs);
    if (jobs_.count(job) > 0) throw std::invalid_argument("job already running");
    for (auto& runner : runners_) {
      if (runner.takes(wanted)) {
        runner.job = job;
        jobs_[job] = runner.name;
        return runner.name;
      }
    }
    return std::nullopt;
  }

  bool finish(std::string job) {
    given(job);
    auto found = jobs_.find(job);
    if (found == jobs_.end()) return false;
    auto runner = find(found->second);
    jobs_.erase(found);
    runner->job.reset();
    leaveIfDrained(runner);
    return true;
  }

  std::vector<std::string> busy() {
    std::vector<std::string> out;
    for (const auto& [_, name] : jobs_) out.push_back(name);
    std::sort(out.begin(), out.end());
    return out;
  }

  // The extension round: a runner on its way out.
  void drain(std::string name) {
    given(name);
    auto runner = find(name);
    if (runner == runners_.end()) throw std::invalid_argument("no such runner");
    runner->draining = true;
    leaveIfDrained(runner);
  }

 private:
  using Runners = std::vector<PoolRunner>;

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty name");
  }

  static std::set<std::string> known(const std::vector<std::string>& capabilities) {
    static const std::set<std::string> all{"build", "test", "deploy", "gpu"};
    for (const auto& c : capabilities)
      if (all.count(c) == 0) throw std::invalid_argument("unknown capability");
    return {capabilities.begin(), capabilities.end()};
  }

  Runners::iterator find(const std::string& name) {
    return std::find_if(runners_.begin(), runners_.end(), [&](const PoolRunner& r) { return r.name == name; });
  }

  void leaveIfDrained(Runners::iterator runner) {
    if (runner->draining && !runner->job) runners_.erase(runner);
  }

  Runners runners_;  // in the order they were added
  std::map<std::string, std::string> jobs_;
};
