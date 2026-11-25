#pragma once
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// What callers see: the real API and its proxy answer the same call.
class AdminApi {
 public:
  virtual ~AdminApi() = default;
  virtual std::string handle(const std::string& user, const std::string& action, const std::string& target) = 0;
};

// The real subject. It does whatever it's asked and knows nothing about roles.
class RealAdminApi : public AdminApi {
 public:
  int64_t calls = 0;

  std::string handle(const std::string&, const std::string& action, const std::string& target) override {
    calls += 1;
    if (deleted_.count(target)) return "404";
    if (action == "suspend") {
      if (!suspended_.insert(target).second) return "409";
    } else if (action == "restore") {
      if (!suspended_.erase(target)) return "409";
    } else if (action == "delete") {
      deleted_.insert(target);
    }
    return "200";
  }

 private:
  std::set<std::string> suspended_;
  std::set<std::string> deleted_;
};

// A protection proxy: the same call as the real API, but it decides first whether the
// call may go through, and writes every attempt down. A call it stops never reaches the
// real API, which the API's own call count shows.
class AdminProxy : public AdminApi {
 public:
  void grant(std::string user, std::string role) {
    given(user);
    if (!rolesTable().count(role)) throw std::invalid_argument("unknown role");
    roles_[user].insert(role);
  }

  std::string handle(const std::string& user, const std::string& action, const std::string& target) override {
    // Who you are (authentication) comes before what you may do (authorization).
    auto held = roles_.find(user);
    if (held == roles_.end()) return "401";
    bool allowed = glass_.count(user) > 0;
    for (const auto& role : held->second) allowed = allowed || rolesTable().at(role).count(action) > 0;
    return allowed ? api_.handle(user, action, target) : "403";
  }

  std::string invoke(std::string user, std::string action, std::string target) {
    given(user);
    if (!actions().count(action)) throw std::invalid_argument("unknown action");
    given(target);
    std::string status = handle(user, action, target);
    std::string line = user + " " + action + " " + target + " " + status;
    log_.push_back(glass_.count(user) ? line + " break-glass" : line);
    return status + " " + action + " " + target;
  }

  std::vector<std::string> audit() { return log_; }

  int64_t realCalls() { return api_.calls; }

  // The extension round: emergency access, marked in the audit.
  bool breakGlass(std::string user) {
    known(user);
    return glass_.insert(user).second;
  }

  bool endBreakGlass(std::string user) {
    known(user);
    return glass_.erase(user) > 0;
  }

 private:
  // Which actions each role may take: the one table a new role is added to.
  static const std::map<std::string, std::set<std::string>>& rolesTable() {
    static const std::map<std::string, std::set<std::string>> table = {
        {"viewer", {"read"}},
        {"operator", {"read", "suspend", "restore"}},
        {"admin", {"read", "suspend", "restore", "delete"}}};
    return table;
  }

  static const std::set<std::string>& actions() {
    static const std::set<std::string> all = {"read", "suspend", "restore", "delete"};
    return all;
  }

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }

  void known(const std::string& user) {
    if (!roles_.count(user)) throw std::invalid_argument("break-glass is for users with a grant");
  }

  RealAdminApi api_;
  std::map<std::string, std::set<std::string>> roles_;
  std::vector<std::string> log_;
  std::set<std::string> glass_;
};
