#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// One check on one field's value; nullopt when the field is absent.
class Rule {
 public:
  virtual ~Rule() = default;
  virtual std::optional<std::string> violation(const std::optional<std::string>& value) const = 0;
};

inline bool isConfigInt(const std::string& text) {
  size_t start = !text.empty() && text[0] == '-' ? 1 : 0;
  size_t digits = text.size() - start;
  if (digits < 1 || digits > 15) return false;
  for (size_t i = start; i < text.size(); i++)
    if (text[i] < '0' || text[i] > '9') return false;
  return true;
}

class Required : public Rule {
 public:
  std::optional<std::string> violation(const std::optional<std::string>& value) const override {
    if (!value) return "missing";
    return std::nullopt;
  }
};

class IntRange : public Rule {
 public:
  IntRange(int64_t low, int64_t high) : low_(low), high_(high) {}
  std::optional<std::string> violation(const std::optional<std::string>& value) const override {
    if (!value) return std::nullopt;
    if (!isConfigInt(*value)) return "not an integer";
    int64_t n = std::stoll(*value);
    if (n < low_ || n > high_) return "out of range";
    return std::nullopt;
  }

 private:
  int64_t low_, high_;
};

class OneOf : public Rule {
 public:
  explicit OneOf(std::vector<std::string> items) : items_(std::move(items)) {}
  std::optional<std::string> violation(const std::optional<std::string>& value) const override {
    if (!value) return std::nullopt;
    for (const auto& item : items_)
      if (item == *value) return std::nullopt;
    return "not allowed";
  }

 private:
  std::vector<std::string> items_;
};

inline std::vector<std::string> splitOn(const std::string& text, char sep) {
  std::vector<std::string> out;
  size_t start = 0;
  for (size_t i = 0; i <= text.size(); i++)
    if (i == text.size() || text[i] == sep) {
      out.push_back(text.substr(start, i - start));
      start = i + 1;
    }
  return out;
}

inline std::shared_ptr<Rule> parseSpec(const std::string& spec) {
  if (spec == "required") return std::make_shared<Required>();
  size_t colon = spec.find(':');
  std::string kind = colon == std::string::npos ? spec : spec.substr(0, colon);
  std::string rest = colon == std::string::npos ? "" : spec.substr(colon + 1);
  if (kind == "int") {
    auto bounds = splitOn(rest, ':');
    if (bounds.size() == 2 && isConfigInt(bounds[0]) && isConfigInt(bounds[1])) {
      int64_t low = std::stoll(bounds[0]), high = std::stoll(bounds[1]);
      if (low <= high) return std::make_shared<IntRange>(low, high);
    }
  } else if (kind == "oneOf") {
    auto items = splitOn(rest, ',');
    bool empty = false;
    for (const auto& item : items) empty = empty || item.empty();
    if (!empty) return std::make_shared<OneOf>(items);
  }
  throw std::invalid_argument("unknown spec");
}

class ConfigSchema {
 public:
  ConfigSchema() {}

  void rule(std::string field, std::string spec) {
    auto parsed = parseSpec(spec);
    bool required = std::dynamic_pointer_cast<Required>(parsed) != nullptr;
    if (field.empty() || (required && fallbacks_.count(field)))
      throw std::invalid_argument("a field name is never empty, and this field can't take this rule");
    rules_[field].push_back(parsed);
  }

  std::vector<std::string> check(std::map<std::string, std::string> env) {
    std::vector<std::string> out;
    for (const auto& [field, rules] : rules_) {
      std::optional<std::string> value;
      if (env.count(field))
        value = env[field];
      else if (fallbacks_.count(field))
        value = fallbacks_[field];
      for (const auto& rule : rules) {
        auto problem = rule->violation(value);
        if (problem) out.push_back(field + ": " + *problem);
      }
    }
    return out;
  }

  std::vector<std::string> fields() {
    std::vector<std::string> out;
    for (const auto& entry : rules_) out.push_back(entry.first);
    return out;
  }

  // The extension round.
  void fallback(std::string field, std::string value) {
    auto found = rules_.find(field);
    bool ok = found != rules_.end();
    if (ok)
      for (const auto& rule : found->second)
        if (std::dynamic_pointer_cast<Required>(rule)) ok = false;
    if (!ok) throw std::invalid_argument("a fallback needs a field with rules and none required");
    fallbacks_[field] = value;
  }

 private:
  std::map<std::string, std::vector<std::shared_ptr<Rule>>> rules_;
  std::map<std::string, std::string> fallbacks_;
};
