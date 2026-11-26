#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace policy {

inline const std::string kAny = "*";
inline const std::string kUser = "{user}";
constexpr int kHours = 24;

inline void checkNamed(const std::string& name) {
  if (name.empty()) throw std::invalid_argument("an empty name");
}

inline int hourPart(const std::string& text) {
  bool ok = !text.empty() && text.size() <= 2 &&
            std::all_of(text.begin(), text.end(), [](char c) { return c >= '0' && c <= '9'; });
  if (!ok) throw std::invalid_argument("an hour is one or two digits");
  return std::stoi(text);
}

inline std::vector<std::string> split(const std::string& text, const std::string& by) {
  std::vector<std::string> out;
  size_t from = 0;
  for (size_t at = text.find(by); at != std::string::npos; at = text.find(by, from)) {
    out.push_back(text.substr(from, at - from));
    from = at + by.size();
  }
  out.push_back(text.substr(from));
  return out;
}

// A resource pattern: literal characters, `*` for any run of characters, and `{user}`
// for the requesting user's name, matched literally.
class Glob {
 public:
  explicit Glob(const std::string& text) {
    std::vector<std::string> chunks = split(text, kUser);
    for (size_t k = 0; k < chunks.size(); k++) {
      if (k > 0) parts_.push_back(kUser);
      for (char c : chunks[k]) {
        if (c == '{' || c == '}') throw std::invalid_argument("a brace outside {user}");
        parts_.push_back(std::string(1, c));
      }
    }
  }

  bool matches(const std::string& resource, const std::string& user) const {
    // nullopt for ANY, otherwise one literal character.
    std::vector<std::optional<char>> items;
    for (const std::string& part : parts_) {
      if (part == kUser) {
        for (char c : user) items.push_back(c);
      } else {
        items.push_back(part == kAny ? std::nullopt : std::optional<char>(part[0]));
      }
    }
    // reach[j]: the items so far can match the first j characters.
    std::vector<bool> reach(resource.size() + 1, false);
    reach[0] = true;
    for (const auto& item : items) {
      std::vector<bool> next(resource.size() + 1, false);
      for (size_t j = 0; j <= resource.size(); j++) {
        if (!item) {
          next[j] = reach[j] || (j > 0 && next[j - 1]);
        } else {
          next[j] = j > 0 && reach[j - 1] && resource[j - 1] == *item;
        }
      }
      reach = next;
    }
    return reach[resource.size()];
  }

 private:
  std::vector<std::string> parts_;  // each one literal character, kAny or kUser
};

// One parsed rule. A request it matches is decided by its effect.
class Policy {
 public:
  Policy(std::string ident, const std::string& text) : id(std::move(ident)), resource_(parse(text)) {}

  bool matches(const std::string& user, const std::vector<std::string>& roles, const std::string& action,
               const std::string& resource, int64_t hour) const {
    return (role_ == kAny || std::find(roles.begin(), roles.end(), role_) != roles.end()) &&
           (action_ == kAny || action_ == action) && (!hours_ || ((*hours_)[0] <= hour && hour < (*hours_)[1])) &&
           resource_.matches(resource, user);
  }

  std::string id;
  std::string effect;

 private:
  // Reads every word but the resource into the fields, and returns the resource's text.
  std::string parse(const std::string& text) {
    std::vector<std::string> words;
    for (const std::string& w : split(text, " "))
      if (!w.empty()) words.push_back(w);
    if ((words.size() != 4 && words.size() != 6) || (words[0] != "allow" && words[0] != "deny"))
      throw std::invalid_argument("effect role action resource [during from-to]");
    effect = words[0];
    role_ = words[1];
    action_ = words[2];
    if (words.size() == 6) {
      std::vector<std::string> hours = split(words[5], "-");
      if (words[4] != "during" || hours.size() != 2) throw std::invalid_argument("during from-to");
      int start = hourPart(hours[0]), end = hourPart(hours[1]);
      if (start >= end || end > kHours) throw std::invalid_argument("hours run forward, up to 24");
      hours_ = std::array<int, 2>{start, end};
    }
    return words[3];
  }

  std::string role_;
  std::string action_;
  std::optional<std::array<int, 2>> hours_;  // from, to (not included)
  Glob resource_;
};

}  // namespace policy

class PolicyEngine {
 public:
  bool addPolicy(std::string id, std::string text) {
    policy::checkNamed(id);
    policy::Policy p(id, text);
    for (const auto& existing : policies_)
      if (existing.id == id) return false;
    policies_.push_back(p);
    return true;
  }

  bool removePolicy(std::string id) {
    policy::checkNamed(id);
    size_t before = policies_.size();
    policies_.erase(std::remove_if(policies_.begin(), policies_.end(), [&](const auto& p) { return p.id == id; }),
                    policies_.end());
    return policies_.size() < before;
  }

  std::string decide(std::string user, std::vector<std::string> roles, std::string action, std::string resource,
                     int64_t hour) {
    return decideWith(policies_, user, roles, action, resource, hour);
  }

  // The extension round: a decision as if one more policy existed.
  std::string simulate(std::string text, std::string user, std::vector<std::string> roles, std::string action,
                       std::string resource, int64_t hour) {
    std::vector<policy::Policy> all = policies_;
    all.emplace_back("(new)", text);
    return decideWith(all, user, roles, action, resource, hour);
  }

 private:
  static std::string decideWith(const std::vector<policy::Policy>& policies, const std::string& user,
                                const std::vector<std::string>& roles, const std::string& action,
                                const std::string& resource, int64_t hour) {
    policy::checkNamed(user);
    policy::checkNamed(action);
    policy::checkNamed(resource);
    for (const auto& role : roles) policy::checkNamed(role);
    if (hour < 0 || hour >= policy::kHours) throw std::invalid_argument("an hour runs from 0 to 23");
    // A chain of responsibility in two passes: any deny that matches decides first, then
    // the earliest allow; with neither, the request falls off the chain.
    for (const std::string effect : {"deny", "allow"})
      for (const auto& p : policies)
        if (p.effect == effect && p.matches(user, roles, action, resource, hour)) return effect + ":" + p.id;
    return "no-match";
  }

  std::vector<policy::Policy> policies_;
};
