#pragma once
#include <cstdint>
#include <stdexcept>
#include <string>

class PaymentIntent;

// One status and the operations it permits. Everything is refused unless a state says
// otherwise, so a new state only names what it allows.
class State {
 public:
  virtual ~State() = default;
  virtual std::string name() const = 0;
  virtual bool confirm(PaymentIntent&) const { return false; }
  virtual bool settle(PaymentIntent&, bool) const { return false; }
  virtual bool capture(PaymentIntent&, int64_t) const { return false; }
  virtual bool refund(PaymentIntent&, int64_t) const { return false; }
  virtual bool dispute(PaymentIntent&, int64_t) const { return false; }
};

class AwaitingPayment : public State {
 public:
  std::string name() const override { return "awaiting_payment"; }
  bool confirm(PaymentIntent& intent) const override;
};

class Processing : public State {
 public:
  std::string name() const override { return "processing"; }
  // A repeated confirm is a retry of the one that got here: accepted, no change.
  bool confirm(PaymentIntent&) const override { return true; }
  bool settle(PaymentIntent& intent, bool succeeded) const override;
};

class Failed : public State {
 public:
  std::string name() const override { return "failed"; }
  bool settle(PaymentIntent&, bool succeeded) const override { return !succeeded; }
};

class Succeeded : public State {
 public:
  std::string name() const override { return "succeeded"; }
  bool settle(PaymentIntent&, bool succeeded) const override { return succeeded; }
  bool capture(PaymentIntent& intent, int64_t cents) const override;
  bool refund(PaymentIntent& intent, int64_t cents) const override;
  bool dispute(PaymentIntent& intent, int64_t cents) const override;
};

class Refunded : public State {
 public:
  std::string name() const override { return "refunded"; }
  bool refund(PaymentIntent& intent, int64_t cents) const override;
  bool dispute(PaymentIntent& intent, int64_t cents) const override;
};

class Disputed : public State {
 public:
  std::string name() const override { return "disputed"; }
};

inline const AwaitingPayment kAwaiting;
inline const Processing kProcessing;
inline const Failed kFailed;
inline const Succeeded kSucceeded;
inline const Refunded kRefunded;
inline const Disputed kDisputed;

// The context: it holds the money and hands each operation to its current state.
class PaymentIntent {
 public:
  explicit PaymentIntent(int64_t amountCents) : amount(amountCents) { checkCents(amountCents); }

  bool confirm() { return state->confirm(*this); }
  bool settle(bool succeeded) { return state->settle(*this, succeeded); }

  bool capture(int64_t cents) {
    checkCents(cents);
    return state->capture(*this, cents);
  }

  bool refund(int64_t cents) {
    checkCents(cents);
    return state->refund(*this, cents);
  }

  std::string status() { return state->name(); }

  bool takeBack(int64_t cents) {
    if (cents > captured - refunded) return false;
    refunded += cents;
    return true;
  }

  // The extension round: a chargeback freezes the payment.
  bool dispute(int64_t cents) {
    checkCents(cents);
    return state->dispute(*this, cents);
  }

  bool disputeHeld(int64_t cents) {
    if (cents > captured - refunded) return false;
    state = &kDisputed;
    return true;
  }

  const int64_t amount;
  int64_t captured = 0;
  int64_t refunded = 0;
  const State* state = &kAwaiting;

 private:
  static void checkCents(int64_t cents) {
    if (cents < 1 || cents > 1'000'000'000) throw std::invalid_argument("cents run from 1 to 10^9");
  }
};

inline bool AwaitingPayment::confirm(PaymentIntent& intent) const {
  intent.state = &kProcessing;
  return true;
}

inline bool Processing::settle(PaymentIntent& intent, bool succeeded) const {
  intent.state = succeeded ? static_cast<const State*>(&kSucceeded) : &kFailed;
  return true;
}

inline bool Succeeded::capture(PaymentIntent& intent, int64_t cents) const {
  if (cents > intent.amount - intent.captured) return false;
  intent.captured += cents;
  return true;
}

inline bool Succeeded::refund(PaymentIntent& intent, int64_t cents) const {
  if (!intent.takeBack(cents)) return false;
  intent.state = &kRefunded;
  return true;
}

inline bool Succeeded::dispute(PaymentIntent& intent, int64_t cents) const { return intent.disputeHeld(cents); }

inline bool Refunded::refund(PaymentIntent& intent, int64_t cents) const { return intent.takeBack(cents); }

inline bool Refunded::dispute(PaymentIntent& intent, int64_t cents) const { return intent.disputeHeld(cents); }
