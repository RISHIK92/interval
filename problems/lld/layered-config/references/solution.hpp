#pragma once
#include <array>
#include <cstdint>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Each source's entries are kept as given; only resolution knows the precedence.
class LayeredConfig {
 public:
  LayeredConfig() {
    for (const auto& s : kSources) layers_[s];
  }

  void layer(std::string source, std::map<std::string, std::string> entries) {
    if (layers_.count(source) == 0) throw std::invalid_argument("unknown source");
    if (entries.count("") > 0) throw std::invalid_argument("a key is not empty");
    layers_[source] = std::move(entries);
  }

  std::optional<std::string> lookup(std::string key) {
    auto found = winner(key);
    if (!found) return std::nullopt;
    return found->second;
  }

  std::optional<std::string> origin(std::string key) {
    auto found = winner(key);
    if (!found) return std::nullopt;
    return found->first;
  }

  std::optional<int64_t> intValue(std::string key) {
    auto found = winner(key);
    if (!found) return std::nullopt;
    return parseInteger(found->second);
  }

  // The extension round: a renamed setting answers to both names.
  void alias(std::string oldKey, std::string newKey) {
    if (oldKey.empty() || newKey.empty() || oldKey == newKey)
      throw std::invalid_argument("two different, non-empty keys");
    for (const auto& [o, n] : renamed_)
      if (o == oldKey || n == oldKey || o == newKey || n == newKey)
        throw std::invalid_argument("a key is in at most one alias");
    renamed_[oldKey] = newKey;
  }

 private:
  // Lowest precedence first: a later source overrides an earlier one.
  static inline const std::array<std::string, 4> kSources = {"defaults", "file", "env", "flags"};

  // Parsing is its own concern: lookup finds the text, this decides what it means.
  static int64_t parseInteger(const std::string& text) {
    // Hand-parsed rather than std::regex: libstdc++'s regex is slow enough to hit the
    // time limit in the judge's gcc image. Same grammar: -?[0-9]{1,15}, the whole text.
    std::size_t sign = !text.empty() && text[0] == '-' ? 1 : 0;
    std::size_t digits = text.size() - sign;
    if (digits < 1 || digits > 15 || text.find_first_not_of("0123456789", sign) != std::string::npos)
      throw std::invalid_argument("not an integer");
    return std::stoll(text);
  }

  // The names a setting may be written under, the current one first.
  std::vector<std::string> names(const std::string& key) const {
    if (key.empty()) throw std::invalid_argument("a key is not empty");
    auto it = renamed_.find(key);
    std::string current = it == renamed_.end() ? key : it->second;
    std::vector<std::string> out = {current};
    for (const auto& [o, n] : renamed_)
      if (n == current) out.push_back(o);
    return out;
  }

  // The winning source and its value.
  std::optional<std::pair<std::string, std::string>> winner(const std::string& key) const {
    auto all = names(key);
    for (auto s = kSources.rbegin(); s != kSources.rend(); ++s) {
      const auto& entries = layers_.at(*s);
      for (const auto& name : all) {
        auto hit = entries.find(name);
        if (hit != entries.end()) return std::make_pair(*s, hit->second);
      }
    }
    return std::nullopt;
  }

  std::map<std::string, std::map<std::string, std::string>> layers_;
  std::map<std::string, std::string> renamed_;  // old key -> new key
};
