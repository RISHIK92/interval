#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>

class Bank {
 public:
  Bank() {}

  void open(std::string account, int64_t balance) {
    if (balance < 0) throw std::invalid_argument("negative opening balance");
    std::lock_guard<std::mutex> hold(mu_);
    if (accounts_.count(account)) throw std::runtime_error("account exists");
    accounts_[account] = balance;
  }

  int64_t deposit(std::string account, int64_t amount) {
    positive(amount);
    std::lock_guard<std::mutex> hold(mu_);
    return at(account) += amount;
  }

  bool withdraw(std::string account, int64_t amount) {
    positive(amount);
    std::lock_guard<std::mutex> hold(mu_);
    int64_t& balance = at(account);
    if (balance < amount) return false;
    balance -= amount;
    return true;
  }

  bool transfer(std::string source, std::string target, int64_t amount) {
    positive(amount);
    if (source == target) throw std::invalid_argument("a transfer needs two accounts");
    std::lock_guard<std::mutex> hold(mu_);
    int64_t& from = at(source);
    int64_t& to = at(target);
    if (from < amount) return false;
    from -= amount;
    to += amount;
    return true;
  }

  int64_t balance(std::string account) {
    std::lock_guard<std::mutex> hold(mu_);
    return at(account);
  }

  int64_t total() {
    std::lock_guard<std::mutex> hold(mu_);
    int64_t sum = 0;
    for (const auto& a : accounts_) sum += a.second;
    return sum;
  }

 private:
  static void positive(int64_t amount) {
    if (amount <= 0) throw std::invalid_argument("amount must be positive");
  }

  int64_t& at(const std::string& account) {
    auto it = accounts_.find(account);
    if (it == accounts_.end()) throw std::out_of_range("unknown account");
    return it->second;
  }

  std::map<std::string, int64_t> accounts_;
  // One lock for the whole ledger: a transfer touches two accounts at once, and a lock
  // per account would need an ordering to avoid deadlock.
  std::mutex mu_;
};
