#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

// Queries are aggregated: panels hold only a query's name, and a query outlives every
// dashboard. Panels are composed: they live inside their dashboard's map.
class Dashboards {
 public:
  Dashboards() {}

  void saveQuery(std::string name, std::string expr) {
    named(name);
    named(expr);
    if (queries_.count(name) > 0) throw std::invalid_argument("query already saved");
    queries_[name] = expr;
  }

  bool addPanel(std::string dashboard, std::string panel, std::string query) {
    named(dashboard);
    named(panel);
    named(query);
    if (queries_.count(query) == 0) return false;
    auto it = dashboards_.find(dashboard);
    if (it != dashboards_.end() && it->second.count(panel) > 0) return false;
    dashboards_[dashboard][panel] = query;
    return true;
  }

  int64_t dropDashboard(std::string dashboard) {
    int64_t count = static_cast<int64_t>(panels(dashboard).size());
    dashboards_.erase(dashboard);
    return count;
  }

  bool dropQuery(std::string name) {
    named(name);
    if (queries_.count(name) == 0 || !usage(name).empty()) return false;
    queries_.erase(name);
    return true;
  }

  std::vector<std::string> usage(std::string query) {
    named(query);
    if (queries_.count(query) == 0) throw std::invalid_argument("unknown query");
    std::vector<std::string> out;
    for (const auto& [dashboard, panels] : dashboards_)
      for (const auto& [panel, used] : panels)
        if (used == query) out.push_back(dashboard + "/" + panel);
    std::sort(out.begin(), out.end());
    return out;
  }

  // The extension round: a copy owns new panels that share the same queries.
  bool duplicate(std::string dashboard, std::string newName) {
    auto copy = panels(dashboard);
    named(newName);
    if (dashboards_.count(newName) > 0) return false;
    dashboards_[newName] = copy;
    return true;
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("names and expressions are not empty");
  }

  const std::map<std::string, std::string>& panels(const std::string& dashboard) {
    named(dashboard);
    auto it = dashboards_.find(dashboard);
    if (it == dashboards_.end()) throw std::invalid_argument("unknown dashboard");
    return it->second;
  }

  std::map<std::string, std::string> queries_;
  std::map<std::string, std::map<std::string, std::string>> dashboards_;
};
