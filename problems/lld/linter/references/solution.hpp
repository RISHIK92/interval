#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// One check over one line. The linter only knows this, so a new rule is a new class and an
// entry in lintRules(), and no existing rule or the linter itself is edited.
class LintRule {
 public:
  virtual ~LintRule() = default;
  virtual bool flags(const std::string& line) const = 0;
};

inline void lintUnused(int64_t param) {
  if (param != 0) throw std::invalid_argument("this rule takes no parameter");
}

class MaxLineLength : public LintRule {
 public:
  explicit MaxLineLength(int64_t param) : limit_(param) {
    if (param < 1) throw std::invalid_argument("a maximum is at least 1");
  }
  bool flags(const std::string& line) const override { return static_cast<int64_t>(line.size()) > limit_; }

 private:
  int64_t limit_;
};

class NoTabs : public LintRule {
 public:
  explicit NoTabs(int64_t param) { lintUnused(param); }
  bool flags(const std::string& line) const override { return line.find('\t') != std::string::npos; }
};

class NoTrailingSpaces : public LintRule {
 public:
  explicit NoTrailingSpaces(int64_t param) { lintUnused(param); }
  bool flags(const std::string& line) const override { return !line.empty() && line.back() == ' '; }
};

using LintRuleMaker = std::function<std::shared_ptr<LintRule>(int64_t)>;

inline const std::map<std::string, LintRuleMaker>& lintRules() {
  static const std::map<std::string, LintRuleMaker> rules{
      {"max-line-length", [](int64_t p) { return std::make_shared<MaxLineLength>(p); }},
      {"no-tabs", [](int64_t p) { return std::make_shared<NoTabs>(p); }},
      {"no-trailing-spaces", [](int64_t p) { return std::make_shared<NoTrailingSpaces>(p); }},
  };
  return rules;
}

// The extension round's rule: written and added without touching the ones above.
class BannedWords : public LintRule {
 public:
  std::set<std::string> words;
  bool flags(const std::string& line) const override {
    for (const auto& word : words)
      if (line.find(word) != std::string::npos) return true;
    return false;
  }
};

class Linter {
 public:
  Linter() = default;

  void enable(std::string rule, int64_t param) {
    auto made = lintRules().find(rule);
    if (made == lintRules().end()) throw std::invalid_argument("unknown rule");
    rules_[rule] = made->second(param);
  }

  std::vector<std::string> lint(std::vector<std::string> lines) {
    std::vector<std::string> out;
    for (size_t i = 0; i < lines.size(); ++i)
      for (const auto& [name, rule] : rules_)
        if (rule->flags(lines[i])) out.push_back(std::to_string(i + 1) + ":" + name);
    return out;
  }

  std::vector<std::string> enabled() {
    std::vector<std::string> out;
    for (const auto& [name, _] : rules_) out.push_back(name);
    return out;
  }

  // The extension round: one more rule, added beside the others.
  void banWord(std::string word) {
    if (word.empty()) throw std::invalid_argument("empty word");
    if (!banned_) {
      banned_ = std::make_shared<BannedWords>();
      rules_["ban-word"] = banned_;
    }
    banned_->words.insert(word);
  }

 private:
  std::map<std::string, std::shared_ptr<LintRule>> rules_;
  std::shared_ptr<BannedWords> banned_;
};
