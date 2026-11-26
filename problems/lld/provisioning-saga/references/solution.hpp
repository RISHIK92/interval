#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A command with its compensation. Each returns what it did, for the trail; an injected
// failure count makes the next attempts fail.
class Step {
 public:
  explicit Step(std::string name) : name(std::move(name)) {}

  std::string execute() {
    if (failures == 0) return "do:" + name;
    failures--;
    return kFailed + name;
  }

  std::string compensate() const { return "undo:" + name; }

  static constexpr const char* kFailed = "fail:";
  const std::string name;
  int64_t failures = 0;
};

// One account's run: the steps done, in order, and everything that happened.
class Saga {
 public:
  void resume(std::vector<Step>& steps, const Step* pivot) {
    // Done steps are skipped, so a retry carries on where the last run stopped and a
    // completed saga runs nothing.
    for (size_t i = done.size(); i < steps.size(); i++) {
      std::string entry = steps[i].execute();
      trail.push_back(entry);
      if (entry.rfind(Step::kFailed, 0) == 0) {
        failed(pivot);
        return;
      }
      done.push_back(&steps[i]);
    }
    status = "completed";
  }

  std::vector<const Step*> done;
  std::vector<std::string> trail;
  std::string status;

 private:
  void failed(const Step* pivot) {
    if (pivot != nullptr && std::find(done.begin(), done.end(), pivot) != done.end()) {
      status = "pending";
      return;
    }
    for (auto it = done.rbegin(); it != done.rend(); ++it) trail.push_back((*it)->compensate());
    done.clear();
    status = "compensated";
  }
};

class ProvisioningSaga {
 public:
  ProvisioningSaga() : steps_{Step("create-user"), Step("create-repo"), Step("grant-access"), Step("send-welcome")} {}

  void failStep(std::string step, int64_t times) {
    Step& found = findStep(step);
    if (times < 0 || times > 1000) throw std::invalid_argument("times runs from 0 to 1000");
    found.failures = times;
  }

  std::string start(std::string account) {
    if (account.empty()) throw std::invalid_argument("an empty account");
    auto found = sagas_.find(account);
    if (found != sagas_.end()) return found->second.status;
    Saga& saga = sagas_[account];
    saga.resume(steps_, pivot_);
    return saga.status;
  }

  std::string retry(std::string account) {
    Saga& saga = findSaga(account);
    saga.resume(steps_, pivot_);
    return saga.status;
  }

  std::vector<std::string> trail(std::string account) { return findSaga(account).trail; }

  std::string status(std::string account) { return findSaga(account).status; }

  // The extension round: a pivot step, past which the saga only moves forward.
  void pivot(std::string step) { pivot_ = &findStep(step); }

 private:
  Step& findStep(const std::string& name) {
    for (Step& step : steps_)
      if (step.name == name) return step;
    throw std::out_of_range("no such step");
  }

  Saga& findSaga(const std::string& account) {
    auto found = sagas_.find(account);
    if (found == sagas_.end()) throw std::out_of_range("no such account");
    return found->second;
  }

  // Fixed at four, so pointers into it stay valid.
  std::vector<Step> steps_;
  std::map<std::string, Saga> sagas_;
  const Step* pivot_ = nullptr;
};
