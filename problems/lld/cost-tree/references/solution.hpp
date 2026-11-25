#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

class CostUnit;

// A component: a service (a leaf) or a unit (a composite). Anyone asking for a total asks
// the node, whichever it is.
class CostNode {
 public:
  CostNode(std::string name, CostUnit* parent) : name(std::move(name)), parent(parent) {}
  virtual ~CostNode() = default;
  virtual int64_t total() const = 0;
  virtual std::vector<CostNode*> children() const = 0;

  std::string name;
  CostUnit* parent;
  int64_t shared = 0;  // cents allocated to this node from above (the extension)
};

class CostService : public CostNode {
 public:
  CostService(std::string name, CostUnit* parent, int64_t cents) : CostNode(std::move(name), parent), cents_(cents) {}
  int64_t total() const override { return cents_ + shared; }
  std::vector<CostNode*> children() const override { return {}; }

 private:
  int64_t cents_;
};

class CostUnit : public CostNode {
 public:
  using CostNode::CostNode;

  int64_t total() const override {
    int64_t sum = shared;
    for (const auto& [key, child] : members) sum += child->total();
    return sum;
  }

  std::vector<CostNode*> children() const override {
    std::vector<CostNode*> out;
    for (const auto& [key, child] : members) out.push_back(child);
    return out;
  }

  // Whether this unit is node itself or somewhere under it.
  bool within(const CostNode* node) const { return this == node || (parent != nullptr && parent->within(node)); }

  // Who is under whom; the tree owns every node.
  std::map<std::string, CostNode*> members;
};

class CostTree {
 public:
  explicit CostTree(std::string root) {
    given(root);
    nodes_[root] = std::make_unique<CostUnit>(root, nullptr);
  }

  bool unit(std::string parent, std::string name) {
    CostUnit* at = unitAt(parent);
    given(name);
    return attach(at, std::make_unique<CostUnit>(name, at));
  }

  bool service(std::string parent, std::string name, int64_t cents) {
    CostUnit* at = unitAt(parent);
    given(name);
    if (cents < 0) throw std::invalid_argument("a cost is never negative");
    return attach(at, std::make_unique<CostService>(name, at, cents));
  }

  int64_t total(std::string node) { return find(node)->total(); }

  bool move(std::string node, std::string parent) {
    CostNode* moving = find(node);
    CostUnit* to = unitAt(parent);
    if (moving->parent == nullptr) throw std::invalid_argument("the root stays where it is");
    if (moving->parent == to || to->within(moving)) return false;
    moving->parent->members.erase(moving->name);
    moving->parent = to;
    to->members[moving->name] = moving;
    return true;
  }

  std::vector<std::string> top(std::string node, int64_t n) {
    CostNode* found = find(node);
    if (n < 0) throw std::invalid_argument("n is never negative");
    std::vector<std::pair<int64_t, std::string>> ranked;
    for (CostNode* child : found->children()) ranked.push_back({-child->total(), child->name});
    std::sort(ranked.begin(), ranked.end());
    std::vector<std::string> out;
    for (size_t i = 0; i < ranked.size() && static_cast<int64_t>(i) < n; i++)
      out.push_back(ranked[i].second + " " + std::to_string(-ranked[i].first));
    return out;
  }

  // The extension round: a cost shared by everything directly under a unit.
  void sharedCost(std::string node, int64_t cents) {
    CostUnit* found = unitAt(node);
    if (cents < 0) throw std::invalid_argument("a cost is never negative");
    // children() comes in name order: members is a sorted map.
    std::vector<CostNode*> children = found->children();
    if (children.empty()) throw std::invalid_argument("nothing to share with");
    int64_t count = static_cast<int64_t>(children.size());
    for (int64_t i = 0; i < count; i++) children[i]->shared += cents / count + (i < cents % count ? 1 : 0);
  }

 private:
  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }

  bool attach(CostUnit* at, std::unique_ptr<CostNode> node) {
    if (nodes_.count(node->name)) return false;
    at->members[node->name] = node.get();
    std::string name = node->name;
    nodes_[name] = std::move(node);
    return true;
  }

  CostNode* find(const std::string& name) {
    auto found = nodes_.find(name);
    if (found == nodes_.end()) throw std::invalid_argument("no such node");
    return found->second.get();
  }

  CostUnit* unitAt(const std::string& name) {
    auto* found = dynamic_cast<CostUnit*>(find(name));
    if (found == nullptr) throw std::invalid_argument("a service has nothing under it");
    return found;
  }

  std::map<std::string, std::unique_ptr<CostNode>> nodes_;
};
