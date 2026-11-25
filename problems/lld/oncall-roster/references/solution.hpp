#pragma once
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Teams aggregate engineers: a team holds its members' names in join order, and each
// engineer knows their teams. Disbanding drops only the team's side and the links.
class OncallRoster {
 public:
  OncallRoster() {}

  void addEngineer(std::string name) {
    named(name);
    if (teamsOf_.count(name) > 0) throw std::invalid_argument("engineer already on the roster");
    teamsOf_[name];
  }

  void addTeam(std::string team) {
    named(team);
    if (members_.count(team) > 0) throw std::invalid_argument("team already exists");
    members_[team];
  }

  bool join(std::string team, std::string name) {
    named(team);
    named(name);
    auto m = members_.find(team);
    auto teams = teamsOf_.find(name);
    if (m == members_.end() || teams == teamsOf_.end())
      throw std::invalid_argument("unknown team or engineer");
    if (!teams->second.insert(team).second) return false;
    m->second.push_back(name);
    return true;
  }

  bool disband(std::string team) {
    named(team);
    auto m = members_.find(team);
    if (m == members_.end()) return false;
    for (const auto& name : m->second) teamsOf_[name].erase(team);
    members_.erase(m);
    lastOnCall_.erase(team);
    return true;
  }

  std::vector<std::string> teamsOf(std::string name) {
    named(name);
    auto teams = teamsOf_.find(name);
    if (teams == teamsOf_.end()) throw std::invalid_argument("unknown engineer");
    return {teams->second.begin(), teams->second.end()};
  }

  // The extension round: the next on call, in join order.
  std::string rotate(std::string team) {
    named(team);
    auto m = members_.find(team);
    if (m == members_.end() || m->second.empty())
      throw std::invalid_argument("unknown team or no members");
    auto last = lastOnCall_.find(team);
    int64_t next = ((last == lastOnCall_.end() ? -1 : last->second) + 1) %
                   static_cast<int64_t>(m->second.size());
    lastOnCall_[team] = next;
    return m->second[next];
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("names are not empty");
  }

  std::map<std::string, std::set<std::string>> teamsOf_;
  std::map<std::string, std::vector<std::string>> members_;
  std::map<std::string, int64_t> lastOnCall_;
};
