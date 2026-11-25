#pragma once
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

class JobSpec {
 public:
  JobSpec(std::string name) : name_(name) {
    if (name.empty()) throw std::invalid_argument("a job needs a name");
  }

  int64_t addStep(std::string command) {
    if (command.empty()) throw std::invalid_argument("a step needs a command");
    steps_.push_back(command);
    return static_cast<int64_t>(steps_.size());
  }

  void setEnv(std::string key, std::string value) { env_[checkedKey(key)] = {value, false}; }

  std::vector<std::string> render() {
    std::vector<std::string> lines{"job " + name_};
    for (const auto& [key, v] : env_) lines.push_back("env " + key + "=" + (v.second ? "***" : v.first));
    for (size_t i = 0; i < steps_.size(); i++) lines.push_back("step " + std::to_string(i + 1) + ": " + steps_[i]);
    return lines;
  }

  int64_t stepCount() { return static_cast<int64_t>(steps_.size()); }

  // The extension round.
  void secret(std::string key, std::string value) { env_[checkedKey(key)] = {value, true}; }

 private:
  static const std::string& checkedKey(const std::string& key) {
    bool ok = !key.empty() && key[0] >= 'A' && key[0] <= 'Z';
    for (char c : key)
      if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_')) ok = false;
    if (!ok) throw std::invalid_argument("an env key is upper snake case");
    return key;
  }

  std::string name_;
  std::vector<std::string> steps_;
  // Sorted by key: (value, secret).
  std::map<std::string, std::pair<std::string, bool>> env_;
};
