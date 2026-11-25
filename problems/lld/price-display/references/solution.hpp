#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

// How one locale writes an amount. Every line asks this one place, so the same amount
// reads the same wherever it's shown.
struct Locale {
  std::string sign;
  bool signFirst;
  std::string grouping;
  std::string decimal;

  std::string price(int64_t amount) const {
    int64_t whole = amount;
    std::string tail;
    if (!decimal.empty()) {
      whole = amount / 100;
      int64_t minor = amount % 100;
      tail = decimal + (minor < 10 ? "0" : "") + std::to_string(minor);
    }
    std::string digits = std::to_string(whole);
    std::vector<std::string> groups;
    for (int64_t end = static_cast<int64_t>(digits.size()); end > 0; end -= 3) {
      int64_t start = std::max<int64_t>(0, end - 3);
      groups.insert(groups.begin(), digits.substr(start, end - start));
    }
    std::string number = groups[0];
    for (size_t i = 1; i < groups.size(); i++) number += grouping + groups[i];
    number += tail;
    return signFirst ? sign + number : number + " " + sign;
  }
};

class PriceFormatter {
 public:
  PriceFormatter() {
    locales_["en-US"] = Locale{"$", true, ",", "."};
    locales_["de-DE"] = Locale{"EUR", false, ".", ","};
    locales_["ja-JP"] = Locale{"JPY", false, ",", ""};
  }

  std::string checkoutLine(int64_t cents, std::string locale) {
    return "Total: " + find(locale).price(checked(cents, kMaxAmount));
  }

  std::string receiptLine(std::string item, int64_t cents, int64_t qty, std::string locale) {
    if (item.empty()) throw std::invalid_argument("an item has a name");
    if (qty < 1 || qty > 1000) throw std::invalid_argument("qty must be within 1 and 1000");
    const Locale& found = find(locale);
    int64_t unit = checked(cents, kMaxUnit);
    return item + " " + std::to_string(qty) + " x " + found.price(unit) + " = " + found.price(unit * qty);
  }

  std::string emailSummary(int64_t totalCents, std::string locale) {
    return "Your order comes to " + find(locale).price(checked(totalCents, kMaxAmount)) + ".";
  }

  // The extension round: a locale is data, so a new one changes no line's code.
  void addLocale(std::string locale, std::string currencySign, bool signFirst, std::string grouping,
                 std::string decimal) {
    if (locale.empty() || locales_.count(locale) > 0)
      throw std::invalid_argument("a locale needs a new, non-empty name");
    if (currencySign.empty()) throw std::invalid_argument("a currency has a sign");
    locales_[locale] = Locale{currencySign, signFirst, grouping, decimal};
  }

 private:
  static constexpr int64_t kMaxAmount = 1000000000000LL;
  static constexpr int64_t kMaxUnit = 1000000000LL;

  static int64_t checked(int64_t amount, int64_t most) {
    if (amount < 0 || amount > most) throw std::invalid_argument("amount out of range");
    return amount;
  }

  const Locale& find(const std::string& locale) const {
    auto found = locales_.find(locale);
    if (found == locales_.end()) throw std::invalid_argument("unknown locale");
    return found->second;
  }

  std::map<std::string, Locale> locales_;
};
