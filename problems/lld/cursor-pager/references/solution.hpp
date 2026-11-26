#pragma once
#include <algorithm>
#include <cstdint>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// A sorted result set, walked one item at a time or a page at a time. A page's cursor is
// the last item seen, so the next page starts after that item wherever it is now.
class ResultPager {
 public:
  ResultPager(std::vector<std::string> items, int64_t pageSize) : items_(std::move(items)), walk_(items_) {
    if (pageSize < 1 || pageSize > kMaxPageSize) throw std::invalid_argument("bad page size");
    for (const auto& item : items_) checkItem(item);
    if (std::set<std::string>(items_.begin(), items_.end()).size() != items_.size())
      throw std::invalid_argument("an item listed twice");
    // std::string compares as unsigned char: character code order.
    std::sort(items_.begin(), items_.end());
    size_ = static_cast<size_t>(pageSize);
  }

  bool hasNext() { return walk_.hasNext(); }

  std::string next() { return walk_.next(); }

  std::vector<std::string> page(std::string cursor) {
    size_t start = after(cursor);
    size_t end = std::min(start + size_, items_.size());
    return std::vector<std::string>(items_.begin() + start, items_.begin() + end);
  }

  std::optional<std::string> nextCursor(std::string cursor) {
    size_t end = after(cursor) + size_;
    if (end < items_.size()) return items_[end - 1];
    return std::nullopt;
  }

  // The extension round: the result set grows while it's being walked.
  void insertItem(std::string item) {
    checkItem(item);
    auto at = std::lower_bound(items_.begin(), items_.end(), item);
    if (at != items_.end() && *at == item) throw std::invalid_argument("already there");
    items_.insert(at, item);
  }

 private:
  static constexpr int64_t kMaxPageSize = 1000;

  // An iterator over the shared, sorted items. It remembers the last item it returned,
  // not a position, so items inserted around it never make it skip or repeat one.
  class Walk {
   public:
    explicit Walk(const std::vector<std::string>& items) : items_(items) {}

    bool hasNext() const { return at() < items_.size(); }

    std::string next() {
      if (!hasNext()) throw std::out_of_range("no more items");
      last_ = items_[at()];
      return *last_;
    }

   private:
    size_t at() const {
      if (!last_) return 0;
      return static_cast<size_t>(std::upper_bound(items_.begin(), items_.end(), *last_) - items_.begin());
    }

    const std::vector<std::string>& items_;
    std::optional<std::string> last_;
  };

  static void checkItem(const std::string& item) {
    if (item.empty()) throw std::invalid_argument("empty item");
  }

  // Where the page after the cursor starts: "" is the start of the results.
  size_t after(const std::string& cursor) const {
    if (cursor.empty()) return 0;
    auto at = std::lower_bound(items_.begin(), items_.end(), cursor);
    if (at == items_.end() || *at != cursor) throw std::invalid_argument("unknown cursor");
    return static_cast<size_t>(at - items_.begin()) + 1;
  }

  std::vector<std::string> items_;
  Walk walk_;
  size_t size_ = 0;
};
