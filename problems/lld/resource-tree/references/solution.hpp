#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

// Nodes compose: each holds its children, and removing one takes its subtree. Grants
// associate a member with a node by name; members are never nodes.
class ResourceTree {
 public:
  explicit ResourceTree(std::string org) {
    named(org);
    org_ = org;
    nodes_[org].kind = "organization";
  }

  bool addNode(std::string parent, std::string node, std::string kind) {
    named(parent);
    named(node);
    named(kind);
    if (parentKind(kind).empty()) throw std::invalid_argument("unknown kind");
    auto holder = nodes_.find(parent);
    if (holder == nodes_.end() || nodes_.count(node) > 0 || parentKind(kind) != holder->second.kind)
      return false;
    holder->second.children.insert(node);
    Node& added = nodes_[node];
    added.kind = kind;
    added.parent = parent;
    return true;
  }

  void attach(std::string node, std::string role, std::string member) {
    named(role);
    named(member);
    get(node).grants.insert({role, member});
  }

  bool can(std::string member, std::string role, std::string node) {
    named(member);
    named(role);
    std::pair<std::string, std::string> key{role, member};
    bool granted = false;
    for (Node* at = &get(node); at != nullptr; at = at->parent ? &nodes_[*at->parent] : nullptr) {
      if (at->denies.count(key) > 0) return false;
      if (at->grants.count(key) > 0) granted = true;
    }
    return granted;
  }

  bool move(std::string node, std::string parent) {
    named(node);
    named(parent);
    auto moving = nodes_.find(node);
    auto holder = nodes_.find(parent);
    if (moving == nodes_.end() || holder == nodes_.end() || node == org_) return false;
    if (parentKind(moving->second.kind) != holder->second.kind) return false;
    nodes_[*moving->second.parent].children.erase(node);
    holder->second.children.insert(node);
    moving->second.parent = parent;
    return true;
  }

  int64_t remove(std::string node) {
    Node& found = get(node);
    if (node == org_) throw std::invalid_argument("the organization can't be removed");
    nodes_[*found.parent].children.erase(node);
    return drop(node);
  }

  // The extension round: a deny below or above overrides every grant.
  void deny(std::string node, std::string role, std::string member) {
    named(role);
    named(member);
    get(node).denies.insert({role, member});
  }

 private:
  struct Node {
    std::string kind;
    std::optional<std::string> parent;
    std::set<std::string> children;
    std::set<std::pair<std::string, std::string>> grants;
    std::set<std::pair<std::string, std::string>> denies;
  };

  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("names, kinds, roles and members are not empty");
  }

  // "" for a kind that can't be added.
  static std::string parentKind(const std::string& kind) {
    if (kind == "folder") return "organization";
    if (kind == "project") return "folder";
    if (kind == "resource") return "project";
    return "";
  }

  Node& get(const std::string& node) {
    named(node);
    auto it = nodes_.find(node);
    if (it == nodes_.end()) throw std::invalid_argument("unknown node");
    return it->second;
  }

  int64_t drop(const std::string& node) {
    int64_t count = 1;
    auto children = nodes_[node].children;
    for (const auto& child : children) count += drop(child);
    nodes_.erase(node);
    return count;
  }

  std::string org_;
  std::map<std::string, Node> nodes_;
};
