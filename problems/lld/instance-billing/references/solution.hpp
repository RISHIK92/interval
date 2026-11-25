#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>

// One instance: the hours it has run. Each kind turns them into cents its own way.
class Billable {
 public:
  explicit Billable(int64_t hourly) : hourly_(hourly) {}
  virtual ~Billable() = default;
  virtual void run(int64_t hours) { hours_ += hours; }
  virtual int64_t bill() const = 0;
  virtual bool interrupt() { throw std::invalid_argument("only a spot instance can be interrupted"); }

 protected:
  int64_t hourly_;
  int64_t hours_ = 0;
};

class OnDemand : public Billable {
 public:
  using Billable::Billable;
  int64_t bill() const override { return hours_ * hourly_; }
};

class Reserved : public Billable {
 public:
  using Billable::Billable;
  // 100 hours paid up front, then 60% of the rate over all the hours run.
  int64_t bill() const override { return 100 * hourly_ + hours_ * hourly_ * 60 / 100; }
};

class Spot : public Billable {
 public:
  using Billable::Billable;
  // Once interrupted, runs are still accepted but no longer billed.
  void run(int64_t hours) override {
    if (!interrupted_) Billable::run(hours);
  }
  int64_t bill() const override { return hours_ * hourly_ * 30 / 100; }
  bool interrupt() override {
    bool first = !interrupted_;
    interrupted_ = true;
    return first;
  }

 private:
  bool interrupted_ = false;
};

class Dedicated : public Billable {
 public:
  Dedicated(int64_t hourly, int64_t hostFee) : Billable(hourly), hostFee_(hostFee) {}
  void run(int64_t hours) override {
    Billable::run(hours);
    runs_++;
  }
  int64_t bill() const override { return hours_ * hourly_ + runs_ * hostFee_; }

 private:
  int64_t hostFee_;
  int64_t runs_ = 0;
};

class BillingMeter {
 public:
  BillingMeter() {}

  void launch(std::string id, std::string kind, int64_t hourlyCents) {
    std::unique_ptr<Billable> instance;
    if (kind == "on-demand")
      instance = std::make_unique<OnDemand>(rate(hourlyCents));
    else if (kind == "reserved")
      instance = std::make_unique<Reserved>(rate(hourlyCents));
    else if (kind == "spot")
      instance = std::make_unique<Spot>(rate(hourlyCents));
    else
      throw std::invalid_argument("unknown kind");
    add(id, std::move(instance));
  }

  void run(std::string id, int64_t hours) {
    if (hours < 1 || hours > kMaxHours) throw std::invalid_argument("hours must be within 1 and 10^4");
    find(id).run(hours);
  }

  int64_t bill(std::string id) { return find(id).bill(); }

  int64_t total() {
    int64_t sum = 0;
    for (const auto& [id, instance] : instances_) sum += instance->bill();
    return sum;
  }

  bool interrupt(std::string id) { return find(id).interrupt(); }

  // The extension round: a fourth kind, added without touching the others.
  void launchDedicated(std::string id, int64_t hourlyCents, int64_t hostFeeCents) {
    if (hostFeeCents < 0 || hostFeeCents > kMaxRate) throw std::invalid_argument("hostFeeCents must be within 0 and 10^6");
    add(id, std::make_unique<Dedicated>(rate(hourlyCents), hostFeeCents));
  }

 private:
  static constexpr int64_t kMaxRate = 1000000;
  static constexpr int64_t kMaxHours = 10000;

  static int64_t rate(int64_t cents) {
    if (cents < 1 || cents > kMaxRate) throw std::invalid_argument("hourlyCents must be within 1 and 10^6");
    return cents;
  }

  void add(const std::string& id, std::unique_ptr<Billable> instance) {
    if (id.empty() || instances_.count(id) > 0) throw std::invalid_argument("an instance needs a new, non-empty id");
    instances_[id] = std::move(instance);
  }

  Billable& find(const std::string& id) {
    auto it = instances_.find(id);
    if (it == instances_.end()) throw std::out_of_range("no such instance");
    return *it->second;
  }

  std::map<std::string, std::unique_ptr<Billable>> instances_;
};
