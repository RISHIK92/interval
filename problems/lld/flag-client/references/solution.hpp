#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

inline const std::string& filled(const std::string& text) {
  if (text.empty()) throw std::invalid_argument("empty");
  return text;
}

// The user's bucket for this flag, 0 to 99: a hash, so it's stable across calls and
// clients, and different flags split users differently.
inline int64_t bucket(const std::string& flag, const std::string& user) {
  int64_t h = 0;
  for (char c : flag + ":" + user) h = (h * 31 + static_cast<unsigned char>(c)) % 1000003;
  return h % 100;
}

// The adapter side: each rule string from the server becomes a small rule object.
class Rule {
 public:
  virtual ~Rule() = default;
  virtual bool matches(const std::string& flag, const std::string& user,
                       const std::map<std::string, std::string>& attrs) const = 0;
};

class UserRule : public Rule {
 public:
  explicit UserRule(const std::string& name) : name_(filled(name)) {}
  bool matches(const std::string&, const std::string& user, const std::map<std::string, std::string>&) const override {
    return user == name_;
  }

 private:
  std::string name_;
};

class AttrRule : public Rule {
 public:
  explicit AttrRule(const std::string& text) {
    size_t eq = text.find('=');
    if (eq == std::string::npos) throw std::invalid_argument("attr:<key>=<value>");
    key_ = filled(text.substr(0, eq));
    value_ = filled(text.substr(eq + 1));
  }
  bool matches(const std::string&, const std::string&,
               const std::map<std::string, std::string>& attrs) const override {
    auto found = attrs.find(key_);
    return found != attrs.end() && found->second == value_;
  }

 private:
  std::string key_;
  std::string value_;
};

class PercentRule : public Rule {
 public:
  explicit PercentRule(const std::string& text) {
    if (text.empty() || text.size() > 3 || (text[0] == '0' && text != "0")) throw std::invalid_argument("0 to 100");
    int64_t n = 0;
    for (char c : text) {
      if (c < '0' || c > '9') throw std::invalid_argument("0 to 100");
      n = n * 10 + (c - '0');
    }
    if (n > 100) throw std::invalid_argument("0 to 100");
    percent_ = n;
  }
  bool matches(const std::string& flag, const std::string& user,
               const std::map<std::string, std::string>&) const override {
    return bucket(flag, user) < percent_;
  }

 private:
  int64_t percent_ = 0;
};

// The facade: evaluate hides fetching, the local copy of the rules (a proxy for the flag
// server) and the rule types. Until a sync reaches the server it answers with the
// defaults; while the server is down it keeps answering from its last copy.
class FlagClient {
 public:
  explicit FlagClient(std::map<std::string, bool> defaults) {
    for (const auto& [flag, on] : defaults) filled(flag);
    defaults_ = defaults;
  }

  void serverRules(std::string flag, std::vector<std::string> rules, int64_t version) {
    filled(flag);
    if (version < 1) throw std::invalid_argument("versions start at 1");
    Rules parsed;
    for (const auto& text : rules) parsed.push_back(parseRule(text));
    auto current = server_.find(flag);
    if (current == server_.end() || version > current->second.version) server_[flag] = Published{parsed, version};
  }

  bool sync(int64_t nowMs, bool reachable) {
    if (!reachable) return false;
    copy_.clear();
    for (const auto& [flag, published] : server_) copy_[flag] = published.rules;
    syncedAt_ = nowMs;
    return true;
  }

  bool evaluate(std::string flag, std::string user, std::map<std::string, std::string> attrs) {
    filled(flag);
    filled(user);
    auto override_ = overrides_.find(flag);
    if (override_ != overrides_.end()) return override_->second;
    auto rules = copy_.find(flag);
    if (rules != copy_.end()) {
      for (const auto& rule : rules->second)
        if (rule->matches(flag, user, attrs)) return true;
      return false;
    }
    auto fallback = defaults_.find(flag);
    if (fallback == defaults_.end()) throw std::out_of_range("no rules and no default");
    return fallback->second;
  }

  int64_t staleMs(int64_t nowMs) {
    if (!syncedAt_) throw std::logic_error("never synced");
    return nowMs - *syncedAt_;
  }

  // The extension round: a local override wins over everything else.
  void localOverride(std::string flag, bool on) { overrides_[filled(flag)] = on; }

 private:
  using Rules = std::vector<std::shared_ptr<const Rule>>;
  struct Published {
    Rules rules;
    int64_t version;
  };

  static std::shared_ptr<const Rule> parseRule(const std::string& text) {
    size_t colon = text.find(':');
    // A rule without a ":" leaves nothing for the rule itself, and every rule needs it.
    std::string kind = text.substr(0, colon);
    std::string rest = colon == std::string::npos ? "" : text.substr(colon + 1);
    if (kind == "user") return std::make_shared<UserRule>(rest);
    if (kind == "attr") return std::make_shared<AttrRule>(rest);
    if (kind == "percent") return std::make_shared<PercentRule>(rest);
    throw std::invalid_argument("an unknown rule");
  }

  std::map<std::string, bool> defaults_;
  std::map<std::string, Published> server_;
  std::map<std::string, Rules> copy_;
  std::optional<int64_t> syncedAt_;
  std::map<std::string, bool> overrides_;
};
