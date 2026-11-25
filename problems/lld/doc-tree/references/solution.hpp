#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A path is a list of segments: a key steps into an object, an index into an array.
struct Segment {
  std::string key;
  size_t index = 0;
  bool isIndex = false;
};

// The composite: scalars, objects and arrays answer the same questions, and a branch
// answers by asking its children.
class Node {
 public:
  virtual ~Node() = default;
  virtual Node* child(const Segment& s) = 0;
  virtual std::string summary() const = 0;
  virtual int64_t size() const = 0;
  virtual void leaves(const std::string& at, std::vector<std::string>& out) const = 0;
};

// A branch can also grow and shrink.
class Branch : public Node {
 public:
  virtual bool room(const Segment& s) const = 0;
  virtual void attach(const Segment& s, std::unique_ptr<Node> n) = 0;
  virtual void detach(const Segment& s) = 0;
};

inline std::string joinPath(const std::string& at, const Segment& s) {
  if (s.isIndex) return at + "[" + std::to_string(s.index) + "]";
  return at.empty() ? s.key : at + "." + s.key;
}

class Scalar : public Node {
 public:
  explicit Scalar(std::string value) : value(std::move(value)) {}
  Node* child(const Segment&) override { return nullptr; }
  std::string summary() const override { return value; }
  int64_t size() const override { return 0; }
  void leaves(const std::string& at, std::vector<std::string>& out) const override { out.push_back(at); }

  std::string value;
};

class ObjectNode : public Branch {
 public:
  Node* child(const Segment& s) override {
    if (s.isIndex) return nullptr;
    auto found = children.find(s.key);
    return found == children.end() ? nullptr : found->second.get();
  }
  bool room(const Segment& s) const override { return !s.isIndex; }
  void attach(const Segment& s, std::unique_ptr<Node> n) override { children[s.key] = std::move(n); }
  void detach(const Segment& s) override { children.erase(s.key); }
  std::string summary() const override { return "object(" + std::to_string(children.size()) + ")"; }
  int64_t size() const override {
    int64_t total = 0;
    for (const auto& [k, c] : children) total += 1 + c->size();
    return total;
  }
  void leaves(const std::string& at, std::vector<std::string>& out) const override {
    for (const auto& [k, c] : children) c->leaves(joinPath(at, Segment{k}), out);
  }

  // In character-code order, which is how leaves are listed.
  std::map<std::string, std::unique_ptr<Node>> children;
};

class ArrayNode : public Branch {
 public:
  Node* child(const Segment& s) override {
    return s.isIndex && s.index < items.size() ? items[s.index].get() : nullptr;
  }
  // An array only grows at its end.
  bool room(const Segment& s) const override { return s.isIndex && s.index == items.size(); }
  void attach(const Segment&, std::unique_ptr<Node> n) override { items.push_back(std::move(n)); }
  void detach(const Segment& s) override { items.erase(items.begin() + static_cast<std::ptrdiff_t>(s.index)); }
  std::string summary() const override { return "array(" + std::to_string(items.size()) + ")"; }
  int64_t size() const override {
    int64_t total = 0;
    for (const auto& item : items) total += 1 + item->size();
    return total;
  }
  void leaves(const std::string& at, std::vector<std::string>& out) const override {
    for (size_t i = 0; i < items.size(); i++) items[i]->leaves(joinPath(at, Segment{"", i, true}), out);
  }

  std::vector<std::unique_ptr<Node>> items;
};

class DocTree {
 public:
  DocTree() = default;

  bool put(std::string path, std::string val) {
    auto segments = parse(path);
    if (segments.empty() || val.empty()) throw std::invalid_argument("a scalar root or an empty value");
    auto [n, at] = walk(segments);
    if (at < segments.size()) return grow(n, segments, at, std::make_unique<Scalar>(val));
    auto* v = dynamic_cast<Scalar*>(n);
    if (v == nullptr) return false;
    v->value = val;
    return true;
  }

  std::optional<std::string> read(std::string path) {
    Node* n = find(parse(path));
    if (n == nullptr) return std::nullopt;
    return n->summary();
  }

  bool remove(std::string path) {
    auto segments = parse(path);
    if (segments.empty()) throw std::invalid_argument("the root stays");
    Segment last = segments.back();
    segments.pop_back();
    auto* parent = dynamic_cast<Branch*>(find(segments));
    if (parent == nullptr || parent->child(last) == nullptr) return false;
    parent->detach(last);
    return true;
  }

  std::vector<std::string> paths(std::string prefix) {
    std::vector<std::string> out;
    Node* n = find(parse(prefix));
    if (n != nullptr) n->leaves(prefix, out);
    return out;
  }

  int64_t count(std::string path) {
    Node* n = find(parse(path));
    if (n == nullptr) throw std::out_of_range("no such node");
    return n->size();
  }

  // The extension round: a shallow merge of scalars into one object.
  int64_t merge(std::string path, std::map<std::string, std::string> entries) {
    auto segments = parse(path);
    for (const auto& [name, value] : entries) {
      parseKey(name);
      if (value.empty()) throw std::invalid_argument("an empty value");
    }
    auto [n, at] = walk(segments);
    if (at < segments.size()) {
      auto made = std::make_unique<ObjectNode>();
      Node* raw = made.get();
      if (!grow(n, segments, at, std::move(made))) throw std::invalid_argument("the path can't be made");
      n = raw;
    }
    auto* target = dynamic_cast<ObjectNode*>(n);
    if (target == nullptr) throw std::invalid_argument("only an object can be merged into");
    int64_t changed = 0;
    for (const auto& [name, value] : entries) {
      auto* old = dynamic_cast<Scalar*>(target->child(Segment{name}));
      if (old != nullptr && old->value == value) continue;
      target->children[name] = std::make_unique<Scalar>(value);
      changed++;
    }
    return changed;
  }

 private:
  static Segment parseKey(const std::string& text) {
    if (text.empty()) throw std::invalid_argument("not a key");
    for (char c : text) {
      bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
      if (!ok) throw std::invalid_argument("not a key");
    }
    return Segment{text};
  }

  static Segment parseIndex(const std::string& text) {
    if (text.empty() || (text[0] == '0' && text != "0")) throw std::invalid_argument("not an index");
    size_t n = 0;
    for (char c : text) {
      if (c < '0' || c > '9') throw std::invalid_argument("not an index");
      n = n * 10 + static_cast<size_t>(c - '0');
    }
    return Segment{"", n, true};
  }

  static std::vector<std::string> split(const std::string& text, char by) {
    std::vector<std::string> out{""};
    for (char c : text) {
      if (c == by) out.emplace_back();
      else out.back() += c;
    }
    return out;
  }

  static std::vector<Segment> parse(const std::string& path) {
    std::vector<Segment> segments;
    if (path.empty()) return segments;
    for (const auto& part : split(path, '.')) {
      auto pieces = split(part, '[');
      segments.push_back(parseKey(pieces[0]));
      for (size_t i = 1; i < pieces.size(); i++) {
        const std::string& piece = pieces[i];
        if (piece.empty() || piece.back() != ']') throw std::invalid_argument("an unclosed [");
        segments.push_back(parseIndex(piece.substr(0, piece.size() - 1)));
      }
    }
    return segments;
  }

  // Follows the path as far as it exists: the last node reached and how many segments
  // it took.
  std::pair<Node*, size_t> walk(const std::vector<Segment>& segments) {
    Node* n = &root_;
    for (size_t i = 0; i < segments.size(); i++) {
      Node* c = n->child(segments[i]);
      if (c == nullptr) return {n, i};
      n = c;
    }
    return {n, segments.size()};
  }

  Node* find(const std::vector<Segment>& segments) {
    auto [n, at] = walk(segments);
    return at < segments.size() ? nullptr : n;
  }

  // Creates the missing part of a path (segments from `at` on), each new branch an object
  // or an array as the segment after it needs, or refuses without changing anything.
  static bool grow(Node* parent, const std::vector<Segment>& segments, size_t at, std::unique_ptr<Node> leaf) {
    auto* b = dynamic_cast<Branch*>(parent);
    if (b == nullptr || !b->room(segments[at])) return false;
    // Every array made here is new and empty, so it can only take index 0.
    for (size_t i = at + 1; i < segments.size(); i++)
      if (segments[i].isIndex && segments[i].index != 0) return false;
    for (size_t i = at; i + 1 < segments.size(); i++) {
      std::unique_ptr<Branch> made;
      if (segments[i + 1].isIndex) made = std::make_unique<ArrayNode>();
      else made = std::make_unique<ObjectNode>();
      Branch* next = made.get();
      b->attach(segments[i], std::move(made));
      b = next;
    }
    b->attach(segments.back(), std::move(leaf));
    return true;
  }

  ObjectNode root_;
};
