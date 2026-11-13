#pragma once
#include <algorithm>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

class OrderBook {
 public:
  OrderBook() {}

  std::vector<std::string> place(std::string id, std::string side, int64_t price, int64_t qty) {
    std::lock_guard<std::mutex> hold(mu_);
    checkSide(side);
    if (price < 1 || price > kMax) throw std::invalid_argument("price out of range");
    if (qty < 1 || qty > kMax) throw std::invalid_argument("quantity out of range");
    if (id.empty()) throw std::invalid_argument("empty id");
    if (orders_.count(id)) throw std::invalid_argument("duplicate id");
    const bool buying = side == "buy";
    auto& other = buying ? sells_ : buys_;
    std::vector<std::string> fills;
    while (qty > 0 && !other.empty()) {
      int64_t best = bestOf(side == "buy" ? "sell" : "buy").value();
      if ((buying && best > price) || (!buying && best < price)) break;
      std::deque<std::string>& queue = other[best];
      std::string makerId = queue.front();
      Order& maker = orders_[makerId];
      int64_t took = std::min(qty, maker.qty);
      fills.push_back(makerId + ":" + std::to_string(best) + ":" + std::to_string(took));
      qty -= took;
      maker.qty -= took;
      matched_ += took;
      if (maker.qty == 0) {
        maker.state = "filled";
        queue.pop_front();
        if (queue.empty()) other.erase(best);
      }
    }
    if (qty > 0) {
      orders_[id] = Order{side, price, qty, "open"};
      (buying ? buys_ : sells_)[price].push_back(id);
    } else {
      orders_[id] = Order{side, price, 0, "filled"};
    }
    return fills;
  }

  int64_t cancel(std::string id) {
    std::lock_guard<std::mutex> hold(mu_);
    Order& order = open(id);
    unlink(id, order);
    int64_t left = order.qty;
    order.qty = 0;
    order.state = "cancelled";
    return left;
  }

  std::optional<int64_t> remaining(std::string id) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = orders_.find(id);
    if (it == orders_.end() || it->second.state != "open") return std::nullopt;
    return it->second.qty;
  }

  std::optional<int64_t> best(std::string side) {
    std::lock_guard<std::mutex> hold(mu_);
    checkSide(side);
    return bestOf(side);
  }

  std::vector<int64_t> depth(std::string side, int64_t levels) {
    std::lock_guard<std::mutex> hold(mu_);
    checkSide(side);
    if (levels < 0) throw std::invalid_argument("negative levels");
    std::vector<int64_t> out;
    int64_t shown = 0;
    auto add = [&](int64_t price, const std::deque<std::string>& queue) {
      int64_t total = 0;
      for (const auto& i : queue) total += orders_[i].qty;
      out.push_back(price);
      out.push_back(total);
    };
    if (side == "buy") {
      for (auto it = buys_.rbegin(); it != buys_.rend() && shown++ < levels; ++it)
        add(it->first, it->second);
    } else {
      for (auto it = sells_.begin(); it != sells_.end() && shown++ < levels; ++it)
        add(it->first, it->second);
    }
    return out;
  }

  void modify(std::string id, int64_t qty) {
    std::lock_guard<std::mutex> hold(mu_);
    Order& order = open(id);
    if (qty < 1 || qty > kMax) throw std::invalid_argument("quantity out of range");
    if (qty > order.qty) {
      // Growing an order costs its place in the queue.
      unlink(id, order);
      (order.side == "buy" ? buys_ : sells_)[order.price].push_back(id);
    }
    order.qty = qty;
  }

  int64_t traded() {
    std::lock_guard<std::mutex> hold(mu_);
    return matched_;
  }

 private:
  static constexpr int64_t kMax = 1000000;

  struct Order {
    std::string side;
    int64_t price = 0;
    int64_t qty = 0;
    std::string state;
  };

  static void checkSide(const std::string& side) {
    if (side != "buy" && side != "sell") throw std::invalid_argument("side must be buy or sell");
  }

  Order& open(const std::string& id) {
    auto it = orders_.find(id);
    if (it == orders_.end()) throw std::out_of_range("unknown id");
    if (it->second.state != "open") throw std::logic_error("order is not open");
    return it->second;
  }

  std::optional<int64_t> bestOf(const std::string& side) {
    if (side == "buy") {
      if (buys_.empty()) return std::nullopt;
      return buys_.rbegin()->first;
    }
    if (sells_.empty()) return std::nullopt;
    return sells_.begin()->first;
  }

  void unlink(const std::string& id, const Order& order) {
    auto& book = order.side == "buy" ? buys_ : sells_;
    std::deque<std::string>& queue = book[order.price];
    queue.erase(std::find(queue.begin(), queue.end(), id));
    if (queue.empty()) book.erase(order.price);
  }

  std::map<int64_t, std::deque<std::string>> buys_;
  std::map<int64_t, std::deque<std::string>> sells_;
  std::unordered_map<std::string, Order> orders_;
  int64_t matched_ = 0;
  std::mutex mu_;
};
