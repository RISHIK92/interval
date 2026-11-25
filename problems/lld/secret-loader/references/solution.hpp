#pragma once
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Stands in for the remote vault: each round trip is counted, and a rotation issues the
// next version of a secret.
class Vault {
 public:
  explicit Vault(const std::vector<std::string>& names) {
    for (const auto& name : names) versions_[name] = 1;
  }
  bool holds(const std::string& name) const { return versions_.count(name) > 0; }
  std::map<std::string, std::string> fetch(const std::set<std::string>& names) {
    trips += 1;
    std::map<std::string, std::string> out;
    for (const auto& name : names) out[name] = name + "#" + std::to_string(versions_.at(name));
    return out;
  }
  void rotate(const std::string& name) { versions_[name] += 1; }

  int64_t trips = 0;

 private:
  std::map<std::string, int64_t> versions_;
};

class SecretLoader {
 public:
  explicit SecretLoader(std::vector<std::string> names) : vault_(checked(names)) {}

  std::string reveal(std::string name) {
    known(name);
    if (cache_.count(name) == 0) warm({name});
    return cache_.at(name);
  }

  int64_t fetches() { return vault_.trips; }

  void rotate(std::string name) {
    known(name);
    vault_.rotate(name);
    cache_.erase(name);
  }

  // The extension round: warm several secrets with one round trip.
  int64_t prefetch(std::vector<std::string> names) {
    for (const auto& name : names) known(name);
    std::set<std::string> cold;
    for (const auto& name : names)
      if (cache_.count(name) == 0) cold.insert(name);
    if (!cold.empty()) warm(cold);
    return static_cast<int64_t>(cold.size());
  }

 private:
  static const std::vector<std::string>& checked(const std::vector<std::string>& names) {
    std::set<std::string> seen;
    for (const auto& name : names) {
      if (name.empty()) throw std::invalid_argument("names are not empty");
      if (!seen.insert(name).second) throw std::invalid_argument("names are unique");
    }
    return names;
  }

  void known(const std::string& name) const {
    if (!vault_.holds(name)) throw std::out_of_range("unknown secret");
  }

  void warm(const std::set<std::string>& names) {
    for (const auto& [n, secret] : vault_.fetch(names)) cache_[n] = secret;
  }

  Vault vault_;
  // A name is here only between its fetch and its next rotation.
  std::map<std::string, std::string> cache_;
};
