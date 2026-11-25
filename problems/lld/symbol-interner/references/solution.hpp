#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

// The flyweight: one immutable record per distinct text, shared by every occurrence.
struct Symbol {
  const int64_t id;
  const std::string text;
};

// The flyweight factory: hands out the one shared symbol for a text, making it only the
// first time the text is seen.
class Interner {
 public:
  int64_t intern(std::string text) {
    if (text.empty()) throw std::invalid_argument("empty text");
    auto shared = byText_.find(text);
    if (shared != byText_.end()) {
      saved_ += static_cast<int64_t>(text.size());
      return shared->second->id;
    }
    auto symbol = std::make_shared<const Symbol>(Symbol{static_cast<int64_t>(byId_.size()), text});
    byText_.emplace(text, symbol);
    byId_.push_back(symbol);
    return symbol->id;
  }

  std::string lookup(int64_t id) {
    if (id < 0 || id >= static_cast<int64_t>(byId_.size())) throw std::invalid_argument("unknown id");
    return byId_[static_cast<size_t>(id)]->text;
  }

  int64_t size() { return static_cast<int64_t>(byId_.size()); }

  int64_t bytesSaved() { return saved_; }

 private:
  std::unordered_map<std::string, std::shared_ptr<const Symbol>> byText_;
  std::vector<std::shared_ptr<const Symbol>> byId_;
  int64_t saved_ = 0;
};
