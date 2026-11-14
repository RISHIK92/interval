#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

class VendingMachine {
 public:
  VendingMachine() {}

  void stock(std::string slot, std::string item, int64_t price, int64_t count) {
    if (slot.empty() || item.empty() || price <= 0 || count < 0)
      throw std::invalid_argument("invalid stock");
    std::lock_guard<std::mutex> hold(mu_);
    slots_[slot] = Slot{item, price, count};
  }

  int64_t insert(int64_t coin) {
    coin_(coin);
    std::lock_guard<std::mutex> hold(mu_);
    pending_[coin]++;
    return credit();
  }

  int64_t balance() {
    std::lock_guard<std::mutex> hold(mu_);
    return credit();
  }

  std::vector<int64_t> buy(std::string slot) {
    std::lock_guard<std::mutex> hold(mu_);
    Slot& entry = at(slot);
    if (entry.count == 0) throw std::runtime_error("sold out");
    int64_t total = credit();
    if (total < entry.price) throw std::runtime_error("not enough credit");
    std::map<int64_t, int64_t> avail;
    for (int64_t c : kCoins) avail[c] = coins_[c] + pending_[c];
    int64_t rest = total - entry.price;
    std::vector<int64_t> change;
    for (int64_t c : kCoins) {
      int64_t take = std::min(rest / c, avail[c]);
      for (int64_t i = 0; i < take; i++) change.push_back(c);
      avail[c] -= take;
      rest -= take * c;
    }
    if (rest != 0) throw std::runtime_error("no exact change");
    coins_ = avail;
    for (int64_t c : kCoins) pending_[c] = 0;
    entry.count--;
    return change;
  }

  std::vector<int64_t> refund() {
    std::lock_guard<std::mutex> hold(mu_);
    std::vector<int64_t> out;
    for (int64_t c : kCoins) {
      for (int64_t i = 0; i < pending_[c]; i++) out.push_back(c);
      pending_[c] = 0;
    }
    return out;
  }

  int64_t inventory(std::string slot) {
    std::lock_guard<std::mutex> hold(mu_);
    return at(slot).count;
  }

  std::string item(std::string slot) {
    std::lock_guard<std::mutex> hold(mu_);
    return at(slot).item;
  }

  void restockCoins(int64_t coin, int64_t count) {
    coin_(coin);
    if (count <= 0) throw std::invalid_argument("count must be positive");
    std::lock_guard<std::mutex> hold(mu_);
    coins_[coin] += count;
  }

  int64_t coinStock(int64_t coin) {
    coin_(coin);
    std::lock_guard<std::mutex> hold(mu_);
    return coins_[coin];
  }

 private:
  struct Slot {
    std::string item;
    int64_t price;
    int64_t count;
  };

  static constexpr int64_t kCoins[4] = {100, 25, 10, 5};

  static void coin_(int64_t coin) {
    for (int64_t c : kCoins)
      if (c == coin) return;
    throw std::invalid_argument("not a coin");
  }

  int64_t credit() {
    int64_t sum = 0;
    for (int64_t c : kCoins) sum += c * pending_[c];
    return sum;
  }

  Slot& at(const std::string& slot) {
    auto it = slots_.find(slot);
    if (it == slots_.end()) throw std::out_of_range("unknown slot");
    return it->second;
  }

  std::map<std::string, Slot> slots_;
  std::map<int64_t, int64_t> coins_;
  std::map<int64_t, int64_t> pending_;
  // One lock for the whole machine: a purchase reads and moves the slot, the credit
  // and the coin inventory together.
  std::mutex mu_;
};
