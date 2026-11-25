#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

class UsageBilling {
 public:
  UsageBilling() {}

  void price(std::string metric, std::string model, std::vector<std::vector<int64_t>> tiers) {
    if (metric.empty()) throw std::invalid_argument("a named metric");
    std::shared_ptr<Pricing> p;
    if (model == "graduated")
      p = std::make_shared<Graduated>(tiers);
    else if (model == "volume")
      p = std::make_shared<Volume>(tiers);
    else
      throw std::invalid_argument("unknown model");
    pricing_[metric] = p;
  }

  void meter(std::string customer, std::string metric, int64_t units) {
    if (customer.empty() || !pricing_.count(metric) || units < 1 || units > kMaxUnits)
      throw std::invalid_argument("a customer, a priced metric and 1-10^9 units");
    usage_[customer][metric] += units;
  }

  std::map<std::string, int64_t> invoice(std::string customer) {
    std::map<std::string, int64_t> out;
    auto it = usage_.find(customer);
    if (it == usage_.end()) return out;
    for (const auto& [metric, units] : it->second) out[metric] = line(metric, units);
    return out;
  }

  int64_t total(std::string customer) {
    int64_t sum = 0;
    for (const auto& [metric, cents] : invoice(customer)) sum += cents;
    return sum;
  }

  // The extension round.
  void minimum(std::string metric, int64_t cents) {
    if (!pricing_.count(metric) || cents < 0 || cents > kMaxMinimumCents)
      throw std::invalid_argument("a priced metric and 0-10^9 cents");
    minimums_[metric] = cents;
  }

 private:
  static constexpr int64_t kMaxUnits = 1000000000LL;
  static constexpr int64_t kMaxMinimumCents = 1000000000LL;
  static constexpr int64_t kMaxRate = 1000000LL;

  // How a metric turns a customer's units into cents.
  struct Pricing {
    std::vector<int64_t> starts, rates;

    explicit Pricing(const std::vector<std::vector<int64_t>>& tiers) {
      if (tiers.empty() || tiers.size() > 10) throw std::invalid_argument("1-10 tiers");
      for (const auto& t : tiers) {
        if (t.size() != 2) throw std::invalid_argument("each tier is [start, centsPerUnit]");
        starts.push_back(t[0]);
        rates.push_back(t[1]);
      }
      if (starts.front() != 0 || starts.back() > kMaxUnits)
        throw std::invalid_argument("starts begin at 0, up to 10^9");
      for (size_t i = 0; i < starts.size(); i++) {
        if (i > 0 && starts[i] <= starts[i - 1]) throw std::invalid_argument("starts rise");
        if (rates[i] < 0 || rates[i] > kMaxRate) throw std::invalid_argument("rates within 0-10^6");
      }
    }
    virtual ~Pricing() = default;
    virtual int64_t charge(int64_t units) const = 0;
  };

  struct Graduated : Pricing {
    using Pricing::Pricing;
    int64_t charge(int64_t units) const override {
      int64_t total = 0;
      for (size_t i = starts.size(); i-- > 0;) {
        int64_t above = std::max<int64_t>(units - starts[i], 0);
        total += above * rates[i];
        units -= above;
      }
      return total;
    }
  };

  struct Volume : Pricing {
    using Pricing::Pricing;
    int64_t charge(int64_t units) const override {
      size_t i = starts.size() - 1;
      while (starts[i] >= units) i--;
      return units * rates[i];
    }
  };

  int64_t line(const std::string& metric, int64_t units) const {
    int64_t charge = pricing_.at(metric)->charge(units);
    auto least = minimums_.find(metric);
    return least == minimums_.end() ? charge : std::max(charge, least->second);
  }

  std::map<std::string, std::shared_ptr<Pricing>> pricing_;
  std::map<std::string, int64_t> minimums_;
  std::map<std::string, std::map<std::string, int64_t>> usage_;
};
