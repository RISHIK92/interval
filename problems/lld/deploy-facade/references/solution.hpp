#pragma once
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// One of the tools a deploy drives (the builder, the registry, the migrator, the
// cluster, the chat bot). Each can run a release and undo it, and can be set to fail its
// next run.
struct Subsystem {
  std::string name;
  bool broken = false;

  std::string run(const std::string& release) const { return name + " " + release; }
  std::string undo(const std::string& release) const { return "undo " + name + " " + release; }
};

// One call in front of five subsystems: it runs them in order, unwinds the ones that ran
// when one fails, and keeps each service's live versions.
class DeployFacade {
 public:
  std::vector<std::string> deploy(std::string service, std::string version) {
    return run(service, version, true);
  }

  void breakStep(std::string step) {
    for (auto& subsystem : steps_) {
      if (subsystem.name == step) {
        subsystem.broken = true;
        return;
      }
    }
    throw std::invalid_argument("unknown step");
  }

  std::vector<std::string> history(std::string service) {
    given(service);
    auto it = live_.find(service);
    if (it == live_.end()) return {};
    return it->second;
  }

  std::optional<std::string> rollback(std::string service) {
    given(service);
    auto it = live_.find(service);
    if (it == live_.end() || it->second.size() < 2) return std::nullopt;
    it->second.pop_back();
    return it->second.back();
  }

  // The extension round: what a deploy would do right now, with nothing changed.
  std::vector<std::string> dryRun(std::string service, std::string version) {
    return run(service, version, false);
  }

 private:
  std::vector<Subsystem> steps_ = {{"build"}, {"push"}, {"migrate"}, {"rollout"}, {"announce"}};
  std::map<std::string, std::vector<std::string>> live_;

  std::vector<std::string> run(const std::string& service, const std::string& version, bool real) {
    given(service);
    given(version);
    const std::string release = service + "@" + version;
    std::vector<std::string> lines;
    std::vector<const Subsystem*> ran;
    for (auto& step : steps_) {
      if (step.broken) {
        if (real) step.broken = false;
        lines.push_back(step.run(release) + " failed");
        for (auto it = ran.rbegin(); it != ran.rend(); ++it) lines.push_back((*it)->undo(release));
        return lines;
      }
      lines.push_back(step.run(release));
      ran.push_back(&step);
    }
    if (real) live_[service].push_back(version);
    return lines;
  }

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }
};
