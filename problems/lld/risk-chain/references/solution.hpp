#pragma once
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

struct Payment {
  std::string customer;
  int64_t cents;
  std::string country;
  int64_t nowMs;
};

// What the checks may look at besides the payment: shared by the whole chain.
struct History {
  static constexpr int64_t kWindowMs = 60000;

  std::set<std::string> blocked;
  std::map<std::string, std::string> home;
  std::map<std::string, std::deque<int64_t>> recent;

  void remember(const Payment& p) {
    home.emplace(p.customer, p.country);
    auto& times = recent[p.customer];
    times.push_back(p.nowMs);
    // Times never decrease, so the ones that left the window are at the front.
    for (size_t i = times.size(); i > 0 && times.front() <= p.nowMs - kWindowMs; i--) times.pop_front();
  }
};

// One link: it decides the payment or returns nothing to pass it to the next link.
class Check {
 public:
  explicit Check(std::string kind) : kind(std::move(kind)) {}
  virtual ~Check() = default;
  virtual std::optional<std::string> decide(const Payment& p, const History& history) const = 0;

  const std::string kind;
};

class Blocklist : public Check {
 public:
  Blocklist() : Check("blocklist") {}
  std::optional<std::string> decide(const Payment& p, const History& history) const override {
    if (history.blocked.count(p.customer)) return "block";
    return std::nullopt;
  }
};

class Velocity : public Check {
 public:
  explicit Velocity(int64_t most) : Check("velocity"), most_(most) {}
  std::optional<std::string> decide(const Payment& p, const History& history) const override {
    if (static_cast<int64_t>(history.recent.at(p.customer).size()) > most_) return "review";
    return std::nullopt;
  }

 private:
  int64_t most_;
};

class AmountLimit : public Check {
 public:
  explicit AmountLimit(int64_t limit) : Check("amount"), limit_(limit) {}
  std::optional<std::string> decide(const Payment& p, const History&) const override {
    if (p.cents > limit_) return "block";
    return std::nullopt;
  }

 private:
  int64_t limit_;
};

class CountryMismatch : public Check {
 public:
  CountryMismatch() : Check("country") {}
  std::optional<std::string> decide(const Payment& p, const History& history) const override {
    if (history.home.at(p.customer) != p.country) return "review";
    return std::nullopt;
  }
};

class RiskChain {
 public:
  void addCheck(std::string check, int64_t param) {
    auto kind = kinds().find(check);
    if (kind == kinds().end()) throw std::invalid_argument("unknown check");
    const Kind& k = kind->second;
    if (param < k.low || (param != k.low && !k.takes)) throw std::invalid_argument("param out of range");
    checks_.push_back(k.make(param));
  }

  void block(std::string customer) {
    if (customer.empty()) throw std::invalid_argument("empty customer");
    history_.blocked.insert(customer);
  }

  std::string assess(std::string customer, int64_t cents, std::string country, int64_t nowMs) {
    if (customer.empty() || country.empty() || cents < 1) throw std::invalid_argument("bad payment");
    Payment p{customer, cents, country, nowMs};
    history_.remember(p);
    std::string verdict = "allow";
    for (const auto& check : checks_) {
      if (skips_.count({customer, check->kind})) continue;
      if (auto decided = check->decide(p, history_)) {
        verdict = *decided;
        break;
      }
    }
    counts_[verdict]++;
    return verdict;
  }

  int64_t decisions(std::string verdict) {
    auto found = counts_.find(verdict);
    if (found == counts_.end()) throw std::invalid_argument("unknown verdict");
    return found->second;
  }

  // The extension round: trusted customers skip a kind of check.
  bool skipFor(std::string customer, std::string check) {
    if (customer.empty() || !kinds().count(check)) throw std::invalid_argument("bad skip");
    return skips_.insert({customer, check}).second;
  }

 private:
  // Each kind with the least param it accepts; blocklist and country take none, so only 0.
  struct Kind {
    std::function<std::unique_ptr<Check>(int64_t)> make;
    int64_t low;
    bool takes;
  };

  static const std::map<std::string, Kind>& kinds() {
    static const std::map<std::string, Kind> all = {
        {"blocklist", {[](int64_t) { return std::make_unique<Blocklist>(); }, 0, false}},
        {"velocity", {[](int64_t n) { return std::make_unique<Velocity>(n); }, 1, true}},
        {"amount", {[](int64_t n) { return std::make_unique<AmountLimit>(n); }, 0, true}},
        {"country", {[](int64_t) { return std::make_unique<CountryMismatch>(); }, 0, false}},
    };
    return all;
  }

  std::vector<std::unique_ptr<Check>> checks_;
  History history_;
  std::map<std::string, int64_t> counts_ = {{"allow", 0}, {"review", 0}, {"block", 0}};
  std::set<std::pair<std::string, std::string>> skips_;
};
