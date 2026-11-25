#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// One kind of secret: a rule rewrites the words it matches and counts them. The
// redactor only decides which rules run and in what order.
class Rule {
 public:
  virtual ~Rule() = default;
  virtual int64_t apply(std::vector<std::string>& words) const = 0;
};

class Emails : public Rule {
 public:
  int64_t apply(std::vector<std::string>& words) const override {
    int64_t hits = 0;
    for (auto& word : words) {
      auto at = word.find('@');
      if (at == std::string::npos || at == 0) continue;
      std::string domain = word.substr(at + 1);
      if (domain.find('@') == std::string::npos && domain.size() > 2 &&
          domain.substr(1, domain.size() - 2).find('.') != std::string::npos) {
        word = "[email]";
        hits++;
      }
    }
    return hits;
  }
};

class Cards : public Rule {
 public:
  int64_t apply(std::vector<std::string>& words) const override {
    int64_t hits = 0;
    for (auto& word : words) {
      bool digits = std::all_of(word.begin(), word.end(), [](char c) { return c >= '0' && c <= '9'; });
      if (digits && word.size() >= 13 && word.size() <= 19) {
        word = std::string(word.size() - 4, '*') + word.substr(word.size() - 4);
        hits++;
      }
    }
    return hits;
  }
};

// Masks the word that comes right after a given word, left to right.
class AfterWord : public Rule {
 public:
  AfterWord(std::string prefix, std::string mask) : prefix_(std::move(prefix)), mask_(std::move(mask)) {}
  int64_t apply(std::vector<std::string>& words) const override {
    int64_t hits = 0;
    for (size_t i = 0; i + 1 < words.size(); i++) {
      if (words[i] == prefix_ && !words[i + 1].empty()) {
        words[i + 1] = mask_;
        hits++;
      }
    }
    return hits;
  }

 private:
  std::string prefix_;
  std::string mask_;
};

class Redactor {
 public:
  Redactor() {
    add("email", std::make_shared<Emails>());
    add("card", std::make_shared<Cards>());
    add("bearer", std::make_shared<AfterWord>("Bearer", "[token]"));
  }

  void enable(std::string rule) {
    known(rule);
    if (std::find(enabled_.begin(), enabled_.end(), rule) == enabled_.end()) enabled_.push_back(rule);
  }

  void disable(std::string rule) {
    known(rule);
    enabled_.erase(std::remove(enabled_.begin(), enabled_.end(), rule), enabled_.end());
  }

  std::string redact(std::string line) {
    std::vector<std::string> words;
    size_t start = 0;
    for (size_t space; (space = line.find(' ', start)) != std::string::npos; start = space + 1)
      words.push_back(line.substr(start, space - start));
    words.push_back(line.substr(start));
    for (const auto& name : enabled_) counts_[name] += rules_[name]->apply(words);
    std::string out = words[0];
    for (size_t i = 1; i < words.size(); i++) out += " " + words[i];
    return out;
  }

  int64_t hits(std::string rule) {
    known(rule);
    return counts_[rule];
  }

  // The extension round: a new rule is one more entry, run like any other.
  void maskAfter(std::string name, std::string prefix) {
    if (name.empty() || rules_.count(name) > 0) throw std::invalid_argument("a rule needs a new, non-empty name");
    if (prefix.empty() || prefix.find(' ') != std::string::npos) throw std::invalid_argument("the prefix is one word");
    add(name, std::make_shared<AfterWord>(prefix, "[" + name + "]"));
  }

 private:
  void add(const std::string& name, std::shared_ptr<const Rule> rule) {
    rules_[name] = std::move(rule);
    counts_[name] = 0;
  }

  void known(const std::string& rule) const {
    if (rules_.count(rule) == 0) throw std::invalid_argument("unknown rule");
  }

  std::map<std::string, std::shared_ptr<const Rule>> rules_;
  std::vector<std::string> enabled_;
  std::map<std::string, int64_t> counts_;
};
