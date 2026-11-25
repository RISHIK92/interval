#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace payment_orchestrator {

constexpr int64_t kMaxCents = 10000000;
constexpr int64_t kMaxFeeBps = 1000;
constexpr int64_t kMaxFailures = 1000;
constexpr int64_t kCardFixedCents = 30;
constexpr int64_t kBankCapCents = 500;
const std::string kFailed = "failed";

// Each kind's fee is its own rule behind one contract: given an amount and a rate in basis
// points, a fee in whole cents. A new kind is a new rule; nothing that charges changes.
struct FeeRule {
  virtual ~FeeRule() = default;
  virtual int64_t fee(int64_t cents, int64_t bps) const = 0;
};

struct CardFee : FeeRule {
  int64_t fee(int64_t cents, int64_t bps) const override { return cents * bps / 10000 + kCardFixedCents; }
};

struct WalletFee : FeeRule {
  int64_t fee(int64_t cents, int64_t bps) const override { return cents * bps / 10000; }
};

struct BankFee : FeeRule {
  int64_t fee(int64_t cents, int64_t bps) const override { return std::min(cents * bps / 10000, kBankCapCents); }
};

inline std::shared_ptr<const FeeRule> feeRule(const std::string& kind) {
  static const std::map<std::string, std::shared_ptr<const FeeRule>> fees = {
      {"card", std::make_shared<CardFee>()},
      {"wallet", std::make_shared<WalletFee>()},
      {"bank", std::make_shared<BankFee>()},
  };
  auto it = fees.find(kind);
  return it == fees.end() ? nullptr : it->second;
}

// A provider as the orchestrator sees it: something that may fail an attempt, and a fee.
struct Provider {
  std::string name;
  std::shared_ptr<const FeeRule> rule;
  int64_t bps;
  int64_t failures = 0;

  bool attempt() {
    if (failures == 0) return true;
    failures--;
    return false;
  }

  int64_t fee(int64_t cents) const { return rule->fee(cents, bps); }
};

// Settlement: what each provider owes the merchant, and what each charge can still refund.
struct Ledger {
  std::map<std::string, int64_t> settled;
  std::map<std::string, std::pair<std::string, int64_t>> captures;

  void open(const std::string& provider) { settled[provider] = 0; }

  void capture(const std::string& key, const Provider& provider, int64_t cents) {
    captures[key] = {provider.name, cents};
    settled[provider.name] += cents - provider.fee(cents);
  }

  bool refund(const std::string& key, int64_t cents) {
    auto it = captures.find(key);
    if (it == captures.end() || cents > it->second.second) return false;
    it->second.second -= cents;
    settled[it->second.first] -= cents;
    return true;
  }
};

// Routing: the order a charge tries providers in.
struct Router {
  std::optional<std::pair<int64_t, std::string>> rule;

  std::vector<std::string> order(const std::vector<std::string>& providers, int64_t cents) const {
    if (!rule || cents < rule->first) return providers;
    std::vector<std::string> out{rule->second};
    for (const std::string& p : providers)
      if (p != rule->second) out.push_back(p);
    return out;
  }
};

inline const std::string& named(const std::string& text) {
  if (text.empty()) throw std::invalid_argument("an empty name");
  return text;
}

inline int64_t checkedCents(int64_t cents) {
  if (cents < 1 || cents > kMaxCents) throw std::invalid_argument("cents are 1 to 10^7");
  return cents;
}

}  // namespace payment_orchestrator

class PaymentOrchestrator {
 public:
  PaymentOrchestrator() {}

  void provider(std::string name, std::string kind, int64_t feeBps) {
    auto rule = payment_orchestrator::feeRule(kind);
    if (providers_.count(payment_orchestrator::named(name)) > 0 || !rule)
      throw std::invalid_argument("a new provider of a known kind");
    if (feeBps < 0 || feeBps > payment_orchestrator::kMaxFeeBps)
      throw std::invalid_argument("a fee is 0 to 1000 basis points");
    providers_[name] = {name, rule, feeBps};
    ledger_.open(name);
  }

  void failProvider(std::string name, int64_t times) {
    if (times < 0 || times > payment_orchestrator::kMaxFailures) throw std::invalid_argument("times is 0 to 1000");
    known(name).failures = times;
  }

  std::string charge(std::string key, std::string customer, int64_t cents, std::vector<std::string> providers) {
    payment_orchestrator::named(key);
    payment_orchestrator::named(customer);
    payment_orchestrator::checkedCents(cents);
    if (providers.empty() || std::set<std::string>(providers.begin(), providers.end()).size() != providers.size())
      throw std::invalid_argument("one or more distinct providers");
    std::vector<payment_orchestrator::Provider*> tried;
    for (const std::string& p : router_.order(providers, cents)) tried.push_back(&known(p));
    if (auto it = outcomes_.find(key); it != outcomes_.end()) return it->second;
    std::string outcome = payment_orchestrator::kFailed;
    for (payment_orchestrator::Provider* provider : tried)
      if (provider->attempt()) {
        ledger_.capture(key, *provider, cents);
        outcome = "captured:" + provider->name;
        break;
      }
    outcomes_[key] = outcome;
    return outcome;
  }

  bool refund(std::string key, int64_t cents) {
    if (outcomes_.count(payment_orchestrator::named(key)) == 0) throw std::invalid_argument("an unknown key");
    return ledger_.refund(key, payment_orchestrator::checkedCents(cents));
  }

  int64_t settled(std::string provider) { return ledger_.settled.at(known(provider).name); }

  // The extension round.
  void routeByAmount(int64_t thresholdCents, std::string provider) {
    int64_t threshold = payment_orchestrator::checkedCents(thresholdCents);
    router_.rule = std::make_pair(threshold, known(provider).name);
  }

 private:
  payment_orchestrator::Provider& known(const std::string& name) {
    auto it = providers_.find(name);
    if (it == providers_.end()) throw std::invalid_argument("an unknown provider");
    return it->second;
  }

  std::map<std::string, payment_orchestrator::Provider> providers_;
  std::map<std::string, std::string> outcomes_;
  payment_orchestrator::Ledger ledger_;
  payment_orchestrator::Router router_;
};
