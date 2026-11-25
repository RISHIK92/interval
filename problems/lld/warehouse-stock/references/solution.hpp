#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

// On hand = available + reserved, per SKU, after every call: the two maps change
// together and only here.
class Warehouse {
 public:
  Warehouse() {}

  int64_t receive(std::string sku, int64_t qty) {
    named(sku);
    counted(qty);
    return onHand_[sku] += qty;
  }

  bool reserve(std::string orderId, std::string sku, int64_t qty) {
    named(orderId);
    named(sku);
    counted(qty);
    if (used_.count(orderId) > 0) throw std::invalid_argument("order id already used");
    if (qty > available(sku)) return false;
    used_.insert(orderId);
    open_[orderId] = {sku, qty};
    reserved_[sku] += qty;
    return true;
  }

  bool ship(std::string orderId) {
    auto order = close(orderId);
    if (!order) return false;
    onHand_[order->first] -= order->second;
    return true;
  }

  bool cancel(std::string orderId) { return close(orderId).has_value(); }

  int64_t available(std::string sku) {
    named(sku);
    return valueOf(onHand_, sku) - valueOf(reserved_, sku);
  }

  // The extension round: damaged stock leaves, but only from what's available.
  bool writeOff(std::string sku, int64_t qty) {
    counted(qty);
    if (qty > available(sku)) return false;
    onHand_[sku] -= qty;
    return true;
  }

 private:
  static constexpr int64_t kMaxQty = 1000000000;

  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("skus and order ids are not empty");
  }

  static void counted(int64_t qty) {
    if (qty < 1 || qty > kMaxQty) throw std::invalid_argument("qty must be within 1 and 10^9");
  }

  static int64_t valueOf(const std::map<std::string, int64_t>& m, const std::string& sku) {
    auto it = m.find(sku);
    return it == m.end() ? 0 : it->second;
  }

  std::optional<std::pair<std::string, int64_t>> close(const std::string& orderId) {
    named(orderId);
    auto it = open_.find(orderId);
    if (it == open_.end()) return std::nullopt;
    auto order = it->second;
    open_.erase(it);
    reserved_[order.first] -= order.second;
    return order;
  }

  std::map<std::string, int64_t> onHand_;
  std::map<std::string, int64_t> reserved_;
  std::map<std::string, std::pair<std::string, int64_t>> open_;
  std::set<std::string> used_;
};
