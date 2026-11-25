#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// The flyweight: a message pattern split once into its literal parts. It holds nothing
// about any one event, so every event with this pattern shares it.
class Template {
 public:
  explicit Template(const std::string& pattern) {
    size_t from = 0;
    for (size_t at = pattern.find("{}"); at != std::string::npos; at = pattern.find("{}", from)) {
      parts_.push_back(pattern.substr(from, at - from));
      from = at + 2;
    }
    parts_.push_back(pattern.substr(from));
  }

  size_t holes() const { return parts_.size() - 1; }

  std::string render(const std::vector<std::string>& params) const {
    std::string out = parts_[0];
    for (size_t i = 0; i < params.size(); i++) out += params[i] + parts_[i + 1];
    return out;
  }

 private:
  std::vector<std::string> parts_;
};

// Events keep only their own parameters and a reference to their template.
class LogStore {
 public:
  LogStore() = default;

  int64_t log(std::string pattern, std::vector<std::string> params) {
    if (pattern.empty()) throw std::invalid_argument("an empty pattern");
    for (const auto& param : params)
      if (param.empty()) throw std::invalid_argument("an empty parameter");
    auto found = byText_.find(pattern);
    auto made = found == byText_.end() ? std::make_shared<const Template>(pattern) : found->second;
    if (made->holes() != params.size()) throw std::invalid_argument("one parameter per {}");
    byText_[pattern] = made;
    last_++;
    events_[last_] = Event{made, params};
    ids_[pattern].push_back(last_);
    return last_;
  }

  std::string render(int64_t eventId) {
    auto found = events_.find(eventId);
    if (found == events_.end()) throw std::out_of_range("unknown event");
    return found->second.shared->render(found->second.params);
  }

  int64_t templates() { return static_cast<int64_t>(byText_.size()); }

  std::vector<int64_t> byPattern(std::string pattern) {
    if (pattern.empty()) throw std::invalid_argument("an empty pattern");
    auto found = ids_.find(pattern);
    return found == ids_.end() ? std::vector<int64_t>{} : found->second;
  }

  // The extension round: a pattern goes, and with it every event that shared it.
  int64_t purge(std::string pattern) {
    if (pattern.empty()) throw std::invalid_argument("an empty pattern");
    auto found = ids_.find(pattern);
    if (found == ids_.end()) return 0;
    std::vector<int64_t> gone = found->second;
    byText_.erase(pattern);
    ids_.erase(found);
    for (int64_t id : gone) events_.erase(id);
    return static_cast<int64_t>(gone.size());
  }

 private:
  struct Event {
    std::shared_ptr<const Template> shared;
    std::vector<std::string> params;
  };

  std::map<std::string, std::shared_ptr<const Template>> byText_;
  std::map<int64_t, Event> events_;
  std::map<std::string, std::vector<int64_t>> ids_;
  int64_t last_ = 0;
};
