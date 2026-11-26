#pragma once
#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Runs CI jobs of every kind through the one template, with the steps skipped and the
// commands to run before each step shared by all kinds.
class JobRunner {
 public:
  std::vector<std::string> steps(std::string kind) { return job(kind)->run(skipped_, "", before_); }

  void skip(std::string step) {
    if (step != "setup" && step != "install") throw std::invalid_argument("only a hook can be skipped");
    skipped_.insert(step);
  }

  std::vector<std::string> runJob(std::string kind, std::string failAt) {
    auto found = job(kind);
    if (!failAt.empty() && std::find(kSteps.begin(), kSteps.end(), failAt) == kSteps.end())
      throw std::invalid_argument("unknown step");
    return found->run(skipped_, failAt, before_);
  }

  // The extension round: a command before every step.
  void beforeEach(std::string command) {
    if (command.empty()) throw std::invalid_argument("empty command");
    before_.push_back(command);
  }

 private:
  inline static const std::vector<std::string> kSteps = {"checkout", "setup", "install", "test", "report"};

  // The template: run() fixes the skeleton and its rules (skipped hooks, stopping at a
  // failure, report always running), and each kind fills in only its own commands.
  // setup and install are hooks: a kind that doesn't override one has no such step.
  struct Job {
    virtual ~Job() = default;
    virtual std::string checkout() const { return "git checkout"; }
    virtual std::optional<std::string> setup() const { return std::nullopt; }
    virtual std::optional<std::string> install() const { return std::nullopt; }
    virtual std::string test() const = 0;
    virtual std::string report() const { return "publish results"; }

    std::vector<std::string> run(const std::set<std::string>& skipped, const std::string& failAt,
                                 const std::vector<std::string>& before) const {
      std::vector<std::optional<std::string>> commands = {checkout(), setup(), install(), test(), report()};
      std::vector<std::string> log;
      bool failed = false;
      for (size_t i = 0; i < kSteps.size(); i++) {
        const std::string& step = kSteps[i];
        if (!commands[i] || skipped.count(step) > 0 || (failed && step != "report")) continue;
        for (const auto& hook : before) log.push_back("before " + step + ": " + hook);
        std::string command = *commands[i];
        if (step == failAt) {
          failed = true;
          command += " [failed]";
        }
        log.push_back(step + ": " + command);
      }
      return log;
    }
  };

  struct NodeJob : Job {
    std::optional<std::string> setup() const override { return "nvm use"; }
    std::optional<std::string> install() const override { return "npm ci"; }
    std::string test() const override { return "npm test"; }
  };

  struct PythonJob : Job {
    std::optional<std::string> setup() const override { return "python -m venv .venv"; }
    std::optional<std::string> install() const override { return "pip install -r requirements.txt"; }
    std::string test() const override { return "pytest"; }
  };

  struct GoJob : Job {
    std::optional<std::string> install() const override { return "go mod download"; }
    std::string test() const override { return "go test ./..."; }
  };

  static std::unique_ptr<Job> job(const std::string& kind) {
    if (kind == "node") return std::make_unique<NodeJob>();
    if (kind == "python") return std::make_unique<PythonJob>();
    if (kind == "go") return std::make_unique<GoJob>();
    throw std::invalid_argument("unknown kind");
  }

  std::set<std::string> skipped_;
  std::vector<std::string> before_;
};
