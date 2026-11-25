#pragma once
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

class AlertGroup;

// A component: a rule (a leaf) or a group (a composite). Callers evaluate, count and mute
// either the same way, without asking which one they hold.
class AlertNode {
 public:
  AlertNode(std::string name, AlertGroup* parent) : name(std::move(name)), parent(parent) {}
  virtual ~AlertNode() = default;

  std::string path() const;

  // Adds the paths of this node's unmuted rules that fire.
  virtual void firing(const std::map<std::string, int64_t>& metrics, std::vector<std::string>& out) const = 0;
  virtual int64_t count() const = 0;

  std::string name;
  AlertGroup* parent;
  bool muted = false;
};

class AlertRule : public AlertNode {
 public:
  AlertRule(std::string name, AlertGroup* parent, std::string metric, int64_t threshold)
      : AlertNode(std::move(name), parent), metric_(std::move(metric)), threshold_(threshold) {}

  void firing(const std::map<std::string, int64_t>& metrics, std::vector<std::string>& out) const override {
    auto value = metrics.find(metric_);
    if (!muted && value != metrics.end() && value->second > threshold_) out.push_back(path());
  }

  int64_t count() const override { return 1; }

 private:
  std::string metric_;
  int64_t threshold_;
};

class AlertGroup : public AlertNode {
 public:
  using AlertNode::AlertNode;

  void firing(const std::map<std::string, int64_t>& metrics, std::vector<std::string>& out) const override {
    // A muted group silences everything under it, whatever their own flags say.
    if (!muted)
      for (const auto& [key, child] : children) child->firing(metrics, out);
  }

  int64_t count() const override {
    int64_t total = 0;
    for (const auto& [key, child] : children) total += child->count();
    return total;
  }

  std::map<std::string, std::unique_ptr<AlertNode>> children;
};

inline std::string AlertNode::path() const {
  if (parent == nullptr) return "/";
  std::string above = parent->path();
  return above == "/" ? "/" + name : above + "/" + name;
}

class AlertTree {
 public:
  bool group(std::string parent, std::string name) {
    AlertGroup* at = groupAt(parent);
    checkName(name);
    return attach(at, name, [&] { return std::make_unique<AlertGroup>(name, at); });
  }

  bool rule(std::string parent, std::string name, std::string metric, int64_t threshold) {
    AlertGroup* at = groupAt(parent);
    checkName(name);
    if (metric.empty()) throw std::invalid_argument("empty metric");
    return attach(at, name, [&] { return std::make_unique<AlertRule>(name, at, metric, threshold); });
  }

  bool mute(std::string node, bool on) {
    AlertNode* found = find(node);
    if (found->muted == on) return false;
    found->muted = on;
    return true;
  }

  std::vector<std::string> firing(std::map<std::string, int64_t> metrics) {
    std::vector<std::string> out;
    root_.firing(metrics, out);
    std::sort(out.begin(), out.end());
    return out;
  }

  int64_t count(std::string node) { return find(node)->count(); }

  // The extension round: moving a subtree, with its mutes.
  bool moveNode(std::string node, std::string parent) {
    AlertNode* moving = find(node);
    AlertGroup* to = groupAt(parent);
    if (moving->parent == nullptr) throw std::invalid_argument("the root stays where it is");
    // A group can't go under itself or anything below it: that would cut it off.
    std::string mine = moving->path() + "/";
    bool inside = (to->path() + "/").compare(0, mine.size(), mine) == 0;
    if (inside || to->children.count(moving->name)) return false;
    auto& from = moving->parent->children;
    auto owned = std::move(from.at(moving->name));
    from.erase(moving->name);
    moving->parent = to;
    to->children[moving->name] = std::move(owned);
    return true;
  }

 private:
  static void checkName(const std::string& name) {
    if (name.empty() || name.find('/') != std::string::npos)
      throw std::invalid_argument("a name is non-empty and has no slash");
  }

  static bool attach(AlertGroup* at, const std::string& name,
                     const std::function<std::unique_ptr<AlertNode>()>& make) {
    if (at->children.count(name)) return false;
    at->children[name] = make();
    return true;
  }

  AlertNode* find(const std::string& path) {
    if (path == "/") return &root_;
    if (path.empty() || path[0] != '/') throw std::invalid_argument("a path starts with a slash");
    AlertNode* at = &root_;
    // Each part runs to the next slash or the end; an empty part matches no child.
    size_t start = 1;
    for (size_t i = 1; i <= path.size(); i++) {
      if (i < path.size() && path[i] != '/') continue;
      auto* group = dynamic_cast<AlertGroup*>(at);
      std::string part = path.substr(start, i - start);
      if (group == nullptr || !group->children.count(part)) throw std::invalid_argument("no such node");
      at = group->children.at(part).get();
      start = i + 1;
    }
    return at;
  }

  AlertGroup* groupAt(const std::string& path) {
    auto* found = dynamic_cast<AlertGroup*>(find(path));
    if (found == nullptr) throw std::invalid_argument("a rule has no children");
    return found;
  }

  AlertGroup root_{"", nullptr};
};
