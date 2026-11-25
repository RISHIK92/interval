#pragma once
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// A prototype: anything made from it is a copy that shares no state with it. It remembers
// the variables it started with, so it can tell what changed since.
class Environment {
 public:
  explicit Environment(const std::map<std::string, std::string>& variables)
      : variables(variables), started(variables) {}

  std::unique_ptr<Environment> copy() const { return std::make_unique<Environment>(variables); }

  std::map<std::string, std::string> variables;
  const std::map<std::string, std::string> started;
};

class EnvTemplates {
 public:
  EnvTemplates() = default;

  void define(std::string name, std::map<std::string, std::string> vars) {
    filled(name);
    for (const auto& [key, value] : vars) {
      filled(key);
      filled(value);
    }
    templates_[name] = std::make_unique<Environment>(vars);
  }

  bool fork(std::string base, std::string env) {
    filled(env);
    auto template_ = templates_.find(base);
    if (template_ == templates_.end()) throw std::out_of_range("unknown template");
    if (envs_.count(env) > 0) return false;
    envs_[env] = template_->second->copy();
    return true;
  }

  bool setVar(std::string env, std::string key, std::string value) {
    Environment& found = lookup(env);
    filled(key);
    filled(value);
    auto current = found.variables.find(key);
    if (current != found.variables.end() && current->second == value) return false;
    found.variables[key] = value;
    return true;
  }

  std::map<std::string, std::string> vars(std::string env) { return lookup(env).variables; }

  // The extension round: what an environment changed since it was forked.
  std::vector<std::string> diff(std::string env) {
    const Environment& found = lookup(env);
    std::vector<std::string> out;
    for (const auto& [key, value] : found.variables) {
      auto was = found.started.find(key);
      if (was == found.started.end()) out.push_back("+" + key + "=" + value);
      else if (was->second != value) out.push_back("~" + key + "=" + value);
    }
    return out;
  }

 private:
  static void filled(const std::string& text) {
    if (text.empty()) throw std::invalid_argument("names, keys and values are not empty");
  }

  Environment& lookup(const std::string& env) {
    auto found = envs_.find(env);
    if (found == envs_.end()) throw std::out_of_range("unknown environment");
    return *found->second;
  }

  std::map<std::string, std::unique_ptr<Environment>> templates_;
  std::map<std::string, std::unique_ptr<Environment>> envs_;
};
