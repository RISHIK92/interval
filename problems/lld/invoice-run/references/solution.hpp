#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

// What the run knows about one customer between invoices.
struct Account {
  int64_t usage = 0;
  int64_t balance = 0;
  int64_t rate = 0;
  int64_t coupon = 0;
};

// The invoice on its way through the steps. `due` is what is still to be charged: each
// step reads it and takes its part off. Tax stays in ten-thousandths of a cent until
// rounding.
struct Draft {
  int64_t subtotal = 0;
  int64_t due = 0;
  int64_t credited = 0;
  int64_t taxExact = 0;
  int64_t tax = 0;
};

// Tax rates in basis points (hundredths of a percent), so cents times a rate is in
// ten-thousandths of a cent.
constexpr int64_t kBasis = 10000;

// Each step is one concern: it sees only what is due, never how earlier steps got there.
inline Draft subtotalStep(const Account& account) {
  Draft draft;
  draft.subtotal = account.usage;
  draft.due = account.usage;
  return draft;
}
inline void discountStep(Draft& draft, const Account& account) { draft.due -= draft.due * account.coupon / 100; }
inline void creditStep(Draft& draft, const Account& account) {
  draft.credited = std::min(account.balance, draft.due);
  draft.due -= draft.credited;
}
inline void taxStep(Draft& draft, const Account& account) { draft.taxExact = draft.due * account.rate; }
inline void roundingStep(Draft& draft) {
  int64_t cents = draft.taxExact / kBasis;
  int64_t rest = draft.taxExact % kBasis;
  draft.tax = 2 * rest >= kBasis ? cents + 1 : cents;
}

class InvoiceRun {
 public:
  InvoiceRun() {}

  void usage(std::string customer, int64_t cents) {
    checkCents(cents);
    account(customer).usage += cents;
  }

  void credit(std::string customer, int64_t cents) {
    checkCents(cents);
    account(customer).balance += cents;
  }

  void region(std::string customer, std::string region) {
    static const std::map<std::string, int64_t> rates = {{"us", 725}, {"eu", 2100}, {"jp", 1000}};
    auto rate = rates.find(region);
    if (rate == rates.end()) throw std::invalid_argument("unknown region");
    account(customer).rate = rate->second;
  }

  std::vector<int64_t> invoice(std::string customer) {
    Account& found = known(customer);
    Draft draft = subtotalStep(found);
    discountStep(draft, found);
    creditStep(draft, found);
    taxStep(draft, found);
    roundingStep(draft);
    found.usage = 0;
    found.balance -= draft.credited;
    found.coupon = 0;
    return {draft.subtotal, draft.credited, draft.tax, draft.due + draft.tax};
  }

  int64_t carryOver(std::string customer) { return known(customer).balance; }

  // The extension round: one more step, between the subtotal and the credits.
  void coupon(std::string customer, int64_t percent) {
    if (percent < 1 || percent > 100) throw std::invalid_argument("percent must be within 1 and 100");
    account(customer).coupon = percent;
  }

 private:
  static void checkCents(int64_t cents) {
    if (cents < 1 || cents > 10000000) throw std::invalid_argument("cents must be within 1 and 10^7");
  }

  Account& account(const std::string& customer) {
    if (customer.empty()) throw std::invalid_argument("a customer has a name");
    return accounts_[customer];
  }

  Account& known(const std::string& customer) {
    auto found = accounts_.find(customer);
    if (found == accounts_.end()) throw std::invalid_argument("unknown customer");
    return found->second;
  }

  std::map<std::string, Account> accounts_;
};
