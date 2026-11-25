#pragma once
#include <cstdint>
#include <deque>
#include <optional>
#include <stdexcept>
#include <string>

// A FIFO queue with stated contracts. Class invariant, true after every call: it holds
// at most `capacity` items.
class WorkQueue {
 public:
  // Precondition: a capacity from 1 to 10^3.
  explicit WorkQueue(int64_t capacity) : capacity_(capacity) {
    if (capacity < 1 || capacity > kMaxCapacity)
      throw std::invalid_argument("capacity is from 1 to 10^3");
  }

  // Precondition: a non-empty item. Postcondition: true with the item at the back, or
  // false with nothing changed when the queue is full.
  bool offer(std::string item) {
    if (item.empty()) throw std::invalid_argument("an item is not empty");
    if (static_cast<int64_t>(items_.size()) == capacity_) return false;
    items_.push_back(item);
    return true;
  }

  // Precondition: the queue isn't empty. Postcondition: the oldest item, removed.
  std::string take() {
    if (items_.empty()) throw std::out_of_range("the queue is empty");
    std::string item = items_.front();
    items_.pop_front();
    return item;
  }

  // No precondition, and it never changes anything.
  std::optional<std::string> peekNext() {
    if (items_.empty()) return std::nullopt;
    return items_.front();
  }

  int64_t size() { return static_cast<int64_t>(items_.size()); }

 private:
  static constexpr int64_t kMaxCapacity = 1000;

  int64_t capacity_;
  std::deque<std::string> items_;
};
