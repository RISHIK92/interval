#pragma once
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// How to make one service: its lifetime, what it needs, and how many it has made. Each
// instance is its service's name and number, followed by the instances it was given, so
// the string shows exactly which instances are shared.
struct Provider {
  std::string service;
  std::string lifetime;
  std::vector<std::string> deps;
  int64_t made = 0;
  std::vector<std::string> wrappers;

  std::string construct(const std::vector<std::string>& given) {
    made += 1;
    std::string instance = service + "#" + std::to_string(made);
    if (!given.empty()) {
      instance += "(";
      for (size_t i = 0; i < given.size(); i++) instance += (i ? "," : "") + given[i];
      instance += ")";
    }
    for (const auto& wrapper : wrappers) instance = wrapper + "[" + instance + "]";
    return instance;
  }
};

// Services are registered with a lifetime and named dependencies, and nothing is made
// until something asks for it. The lifetime decides where an instance is kept: once for
// the container, once per scope, or nowhere (a new one every time).
class DiContainer {
 public:
  void provide(std::string service, std::string lifetime, std::vector<std::string> deps) {
    given(service);
    if (lifetime != "singleton" && lifetime != "transient" && lifetime != "scoped")
      throw std::invalid_argument("unknown lifetime");
    for (const auto& dep : deps) given(dep);
    if (std::set<std::string>(deps.begin(), deps.end()).size() != deps.size())
      throw std::invalid_argument("a dependency listed twice");
    if (providers_.count(service)) throw std::invalid_argument("already provided");
    providers_[service] = Provider{service, lifetime, deps, 0, {}};
  }

  std::string resolve(std::string service, std::string scope) {
    given(scope);
    // Check the whole graph first, so a resolve that fails constructs nothing.
    std::set<std::string> path;
    std::set<std::pair<std::string, bool>> done;
    check(service, false, path, done);
    return instance(service, scope);
  }

  int64_t constructed(std::string service) { return provider(service).made; }

  int64_t endScope(std::string scope) {
    given(scope);
    auto ended = scopes_.find(scope);
    if (ended == scopes_.end()) return 0;
    int64_t size = static_cast<int64_t>(ended->second.size());
    scopes_.erase(ended);
    return size;
  }

  // The extension round: wrapping a service without changing it.
  void decorate(std::string service, std::string wrapper) {
    given(wrapper);
    provider(service).wrappers.push_back(wrapper);
  }

 private:
  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }

  Provider& provider(const std::string& service) {
    auto found = providers_.find(service);
    if (found == providers_.end()) throw std::invalid_argument("unknown service");
    return found->second;
  }

  void check(const std::string& service, bool inSingleton, std::set<std::string>& path,
             std::set<std::pair<std::string, bool>>& done) {
    const Provider& p = provider(service);
    if (path.count(service)) throw std::invalid_argument("a dependency cycle");
    if (inSingleton && p.lifetime == "scoped")
      throw std::invalid_argument("a singleton would hold on to a scoped instance");
    if (done.count({service, inSingleton})) return;
    path.insert(service);
    for (const auto& dep : p.deps) check(dep, inSingleton || p.lifetime == "singleton", path, done);
    path.erase(service);
    done.insert({service, inSingleton});
  }

  std::string instance(const std::string& service, const std::string& scope) {
    Provider& p = providers_.at(service);
    std::map<std::string, std::string>* kept = nullptr;
    if (p.lifetime == "singleton")
      kept = &singletons_;
    else if (p.lifetime == "scoped")
      kept = &scopes_[scope];
    if (kept && kept->count(service)) return kept->at(service);
    std::vector<std::string> deps;
    for (const auto& dep : p.deps) deps.push_back(instance(dep, scope));
    std::string built = p.construct(deps);
    if (kept) (*kept)[service] = built;
    return built;
  }

  std::map<std::string, Provider> providers_;
  std::map<std::string, std::string> singletons_;
  std::map<std::string, std::map<std::string, std::string>> scopes_;
};
