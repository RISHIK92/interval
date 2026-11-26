#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace alert {

constexpr size_t kMaxDigits = 15;

inline bool isDigit(char c) { return c >= '0' && c <= '9'; }
inline bool isLetter(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
inline bool isNameChar(char c) { return isLetter(c) || isDigit(c) || c == '_' || c == '.'; }
inline bool isKeyword(const std::string& s) { return s == "and" || s == "or" || s == "not"; }
inline bool isOp(const std::string& s) {
  return s == ">" || s == ">=" || s == "<" || s == "<=" || s == "==" || s == "!=";
}
inline bool isName(const std::string& s) {
  if (s.empty() || !isLetter(s[0]) || isKeyword(s)) return false;
  return std::all_of(s.begin(), s.end(), isNameChar);
}

struct Tally {
  int64_t comparisons = 0;
};

// An expression in the language: a comparison, or not, and, or over expressions.
class Node {
 public:
  virtual ~Node() = default;
  virtual bool evaluate(const std::map<std::string, int64_t>& metrics, Tally& seen) const = 0;
  virtual int64_t depth() const = 0;
  virtual void names(std::set<std::string>& out) const = 0;
  virtual void rename(const std::string& from, const std::string& to) = 0;
  virtual std::string text() const = 0;
};

class Compare : public Node {
 public:
  Compare(std::string metric, std::string op, int64_t value)
      : metric_(std::move(metric)), op_(std::move(op)), value_(value) {}

  bool evaluate(const std::map<std::string, int64_t>& metrics, Tally& seen) const override {
    seen.comparisons += 1;
    auto at = metrics.find(metric_);
    if (at == metrics.end()) return false;
    int64_t v = at->second;
    if (op_ == ">") return v > value_;
    if (op_ == ">=") return v >= value_;
    if (op_ == "<") return v < value_;
    if (op_ == "<=") return v <= value_;
    if (op_ == "==") return v == value_;
    return v != value_;
  }
  int64_t depth() const override { return 1; }
  void names(std::set<std::string>& out) const override { out.insert(metric_); }
  void rename(const std::string& from, const std::string& to) override {
    if (metric_ == from) metric_ = to;
  }
  std::string text() const override { return metric_ + " " + op_ + " " + std::to_string(value_); }

 private:
  std::string metric_;
  std::string op_;
  int64_t value_;
};

class Not : public Node {
 public:
  explicit Not(std::unique_ptr<Node> inner) : inner_(std::move(inner)) {}

  bool evaluate(const std::map<std::string, int64_t>& metrics, Tally& seen) const override {
    return !inner_->evaluate(metrics, seen);
  }
  int64_t depth() const override { return 1 + inner_->depth(); }
  void names(std::set<std::string>& out) const override { inner_->names(out); }
  void rename(const std::string& from, const std::string& to) override { inner_->rename(from, to); }
  std::string text() const override { return "not " + inner_->text(); }

 private:
  std::unique_ptr<Node> inner_;
};

class Binary : public Node {
 public:
  Binary(std::string word, std::unique_ptr<Node> left, std::unique_ptr<Node> right)
      : word_(std::move(word)), left_(std::move(left)), right_(std::move(right)) {}

  bool evaluate(const std::map<std::string, int64_t>& metrics, Tally& seen) const override {
    if (word_ == "and") return left_->evaluate(metrics, seen) && right_->evaluate(metrics, seen);
    return left_->evaluate(metrics, seen) || right_->evaluate(metrics, seen);
  }
  int64_t depth() const override { return 1 + std::max(left_->depth(), right_->depth()); }
  void names(std::set<std::string>& out) const override {
    left_->names(out);
    right_->names(out);
  }
  void rename(const std::string& from, const std::string& to) override {
    left_->rename(from, to);
    right_->rename(from, to);
  }
  std::string text() const override { return "(" + left_->text() + " " + word_ + " " + right_->text() + ")"; }

 private:
  std::string word_;
  std::unique_ptr<Node> left_, right_;
};

struct Token {
  std::string kind, text;
};

inline std::vector<Token> tokenize(const std::string& s) {
  std::vector<Token> tokens;
  for (size_t i = 0; i < s.size();) {
    char c = s[i];
    size_t j = i + 1;
    std::string two = s.substr(i, 2);
    if (c == ' ') {
      i = j;
      continue;
    }
    if (isDigit(c) || (c == '-' && j < s.size() && isDigit(s[j]))) {
      for (; j < s.size() && isDigit(s[j]); j++) {
      }
      tokens.push_back({"number", s.substr(i, j - i)});
    } else if (isLetter(c)) {
      for (; j < s.size() && isNameChar(s[j]); j++) {
      }
      tokens.push_back({"word", s.substr(i, j - i)});
    } else if (two.size() == 2 && isOp(two)) {
      j = i + 2;
      tokens.push_back({"symbol", two});
    } else if (c == '<' || c == '>' || c == '(' || c == ')') {
      tokens.push_back({"symbol", std::string(1, c)});
    } else {
      throw std::invalid_argument("unexpected character");
    }
    i = j;
  }
  return tokens;
}

// Recursive descent: each method parses one level of the grammar.
class Parser {
 public:
  explicit Parser(const std::string& text) : tokens_(tokenize(text)) {}

  std::unique_ptr<Node> parse() {
    auto tree = disjunction();
    if (pos_ != tokens_.size()) throw std::invalid_argument("unexpected token");
    return tree;
  }

 private:
  std::unique_ptr<Node> disjunction() {
    auto tree = conjunction();
    while (take("or")) tree = std::make_unique<Binary>("or", std::move(tree), conjunction());
    return tree;
  }

  std::unique_ptr<Node> conjunction() {
    auto tree = negation();
    while (take("and")) tree = std::make_unique<Binary>("and", std::move(tree), negation());
    return tree;
  }

  std::unique_ptr<Node> negation() {
    if (take("not")) return std::make_unique<Not>(negation());
    if (take("(")) {
      auto tree = disjunction();
      expect("symbol", ")");
      return tree;
    }
    std::string metric = expect("word");
    if (isKeyword(metric)) throw std::invalid_argument("a keyword is not a metric");
    std::string op = expect("symbol");
    if (!isOp(op)) throw std::invalid_argument("not a comparison");
    std::string number = expect("number");
    size_t digits = number.size() - (number[0] == '-' ? 1 : 0);
    if (digits > kMaxDigits) throw std::invalid_argument("number too long");
    return std::make_unique<Compare>(metric, op, std::stoll(number));
  }

  bool take(const std::string& text) {
    bool found = pos_ < tokens_.size() && tokens_[pos_].text == text;
    if (found) pos_ += 1;
    return found;
  }

  std::string expect(const std::string& kind, const std::string& text = "") {
    if (pos_ == tokens_.size()) throw std::invalid_argument("unexpected end");
    const Token& got = tokens_[pos_];
    if (got.kind != kind || (!text.empty() && got.text != text)) throw std::invalid_argument("unexpected token");
    pos_ += 1;
    return got.text;
  }

  std::vector<Token> tokens_;
  size_t pos_ = 0;
};

}  // namespace alert

class AlertExpr {
 public:
  explicit AlertExpr(std::string expression) : tree_(alert::Parser(expression).parse()) {}

  bool evaluate(const std::map<std::string, int64_t>& metrics) { return tree_->evaluate(metrics, seen_); }

  std::vector<std::string> variables() {
    std::set<std::string> out;
    tree_->names(out);
    return {out.begin(), out.end()};
  }

  int64_t depth() { return tree_->depth(); }

  int64_t evaluations() { return seen_.comparisons; }

  // The extension round: renaming a metric in the parsed tree.
  std::string rewrite(std::string name, std::string replacement) {
    std::set<std::string> names;
    tree_->names(names);
    if (!names.count(name) || !alert::isName(replacement)) throw std::invalid_argument("unknown metric or bad name");
    tree_->rename(name, replacement);
    return tree_->text();
  }

 private:
  std::unique_ptr<alert::Node> tree_;
  alert::Tally seen_;
};
