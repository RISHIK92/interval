#pragma once
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

class Money {
 public:
  Money(int64_t cents, std::string currency) : cents_(cents), currency_(currency) { checked(cents, currency); }

  std::string add(int64_t cents, std::string currency) {
    checked(cents, currency);
    if (currency != currency_) throw std::invalid_argument("can't add across currencies");
    return show(cents_ + cents);
  }

  std::vector<std::string> split(int64_t parts) {
    if (parts < 1 || parts > 100) throw std::invalid_argument("parts must be within 1-100");
    int64_t share = cents_ / parts, left = cents_ % parts;
    std::vector<std::string> out;
    for (int64_t i = 0; i < parts; i++) out.push_back(show(share + (i < left ? 1 : 0)));
    return out;
  }

  std::string display() { return show(cents_); }

  // The extension round.
  std::vector<std::string> allocate(std::vector<int64_t> weights) {
    if (weights.empty() || weights.size() > 100) throw std::invalid_argument("1-100 weights");
    int64_t total = 0;
    for (int64_t w : weights) {
      if (w < 0 || w > 1000) throw std::invalid_argument("each weight within 0-1000");
      total += w;
    }
    if (total == 0) throw std::invalid_argument("at least one weight above 0");
    std::vector<int64_t> shares;
    int64_t left = cents_;
    for (int64_t w : weights) {
      shares.push_back(cents_ * w / total);
      left -= shares.back();
    }
    for (size_t i = 0; i < shares.size() && left > 0; i++)
      if (weights[i] > 0) {
        shares[i]++;
        left--;
      }
    std::vector<std::string> out;
    for (int64_t s : shares) out.push_back(show(s));
    return out;
  }

 private:
  static constexpr int64_t kLimit = 1000000000000LL;

  static void checked(int64_t cents, const std::string& currency) {
    if (cents < 0 || cents > kLimit) throw std::invalid_argument("cents must be within 0 and 10^12");
    if (currency.size() != 3) throw std::invalid_argument("a currency is three capital letters");
    for (char c : currency)
      if (c < 'A' || c > 'Z') throw std::invalid_argument("a currency is three capital letters");
  }

  std::string show(int64_t amount) const {
    char rest[3];
    std::snprintf(rest, sizeof rest, "%02d", static_cast<int>(amount % 100));
    return currency_ + " " + std::to_string(amount / 100) + "." + rest;
  }

  int64_t cents_;
  std::string currency_;
};
