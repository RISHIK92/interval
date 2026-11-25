#pragma once
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Each package keeps the packages it uses, in declared order, and the reverse links to
// its dependents. Dependencies must already exist, so the graph never has a cycle.
class PackageGraph {
 public:
  PackageGraph() {}

  bool add(std::string pkg, std::vector<std::string> deps) {
    named(pkg);
    for (const auto& d : deps) named(d);
    if (std::set<std::string>(deps.begin(), deps.end()).size() != deps.size())
      throw std::invalid_argument("a dependency is listed twice");
    if (deps_.count(pkg) > 0) return false;
    for (const auto& d : deps)
      if (deps_.count(d) == 0) return false;
    deps_[pkg] = deps;
    users_[pkg];
    for (const auto& d : deps) users_[d].insert(pkg);
    return true;
  }

  bool remove(std::string pkg) {
    named(pkg);
    auto found = users_.find(pkg);
    if (found == users_.end() || !found->second.empty()) return false;
    for (const auto& d : deps_[pkg]) users_[d].erase(pkg);
    deps_.erase(pkg);
    users_.erase(found);
    pinned_.erase(pkg);
    return true;
  }

  std::vector<std::string> dependents(std::string pkg) {
    const auto& found = usersOf(pkg);
    return {found.begin(), found.end()};
  }

  std::vector<std::string> installOrder(std::string pkg) {
    usersOf(pkg);
    std::vector<std::string> order;
    std::set<std::string> listed;
    visit(pkg, order, listed);
    return order;
  }

  // The extension round: pinned packages are never unused.
  void pin(std::string pkg) {
    usersOf(pkg);
    pinned_.insert(pkg);
  }

  std::vector<std::string> unused() {
    std::vector<std::string> out;
    for (const auto& [p, found] : users_)
      if (found.empty() && pinned_.count(p) == 0) out.push_back(p);
    return out;
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("package names are not empty");
  }

  const std::set<std::string>& usersOf(const std::string& pkg) {
    named(pkg);
    auto found = users_.find(pkg);
    if (found == users_.end()) throw std::invalid_argument("unknown package");
    return found->second;
  }

  void visit(const std::string& p, std::vector<std::string>& order, std::set<std::string>& listed) {
    if (listed.count(p) > 0) return;
    for (const auto& d : deps_[p]) visit(d, order, listed);
    listed.insert(p);
    order.push_back(p);
  }

  std::map<std::string, std::vector<std::string>> deps_;
  std::map<std::string, std::set<std::string>> users_;
  std::set<std::string> pinned_;
};
