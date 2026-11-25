#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Each person knows their manager, and each manager knows their direct reports; the two
// sides change together. The root is the one person with no manager.
class OrgChart {
 public:
  explicit OrgChart(std::string ceo) {
    named(ceo);
    root_ = ceo;
    manager_[ceo] = std::nullopt;
    reports_[ceo];
  }

  bool hire(std::string name, std::string manager) {
    named(name);
    named(manager);
    if (manager_.count(name) > 0 || manager_.count(manager) == 0) return false;
    reports_[name];
    link(name, manager);
    return true;
  }

  bool reassign(std::string name, std::string manager) {
    named(name);
    named(manager);
    if (manager_.count(name) == 0 || manager_.count(manager) == 0 || name == root_) return false;
    auto up = chain(manager);
    if (std::find(up.begin(), up.end(), name) != up.end()) return false;
    unlink(name);
    link(name, manager);
    return true;
  }

  bool leave(std::string name) {
    named(name);
    if (manager_.count(name) == 0 || name == root_) return false;
    auto up = manager_[name];
    unlink(name);
    auto mine = reports_[name];
    reports_.erase(name);
    for (const auto& report : mine) link(report, up);
    manager_.erase(name);
    return true;
  }

  std::vector<std::string> chain(std::string name) {
    named(name);
    if (manager_.count(name) == 0) throw std::invalid_argument("unknown person");
    std::vector<std::string> out;
    std::optional<std::string> at = name;
    while (at) {
      out.push_back(*at);
      at = manager_[*at];
    }
    return out;
  }

  int64_t span(std::string manager) {
    named(manager);
    auto it = reports_.find(manager);
    if (it == reports_.end()) throw std::invalid_argument("unknown person");
    return static_cast<int64_t>(it->second.size());
  }

  // The extension round: a person swaps places with their manager.
  bool promote(std::string name) {
    named(name);
    if (manager_.count(name) == 0 || name == root_) return false;
    std::string boss = *manager_[name];  // only the root has no manager
    auto above = manager_[boss];
    auto theirs = reports_[boss];
    theirs.erase(name);
    auto mine = reports_[name];
    unlink(boss);
    link(name, above);
    reports_[name].clear();
    reports_[boss].clear();
    link(boss, name);
    for (const auto& report : theirs) link(report, name);
    for (const auto& report : mine) link(report, boss);
    if (boss == root_) root_ = name;
    return true;
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("names are not empty");
  }

  void link(const std::string& name, const std::optional<std::string>& manager) {
    manager_[name] = manager;
    if (manager) reports_[*manager].insert(name);
  }

  void unlink(const std::string& name) {
    auto manager = manager_[name];
    if (manager) reports_[*manager].erase(name);
  }

  std::string root_;
  std::map<std::string, std::optional<std::string>> manager_;
  std::map<std::string, std::set<std::string>> reports_;
};
