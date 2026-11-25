#pragma once
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// An abstract factory for a family of resources that belong together. A recipe names its
// parts after the name it's given and says how they depend on each other.
class Recipe {
 public:
  struct Part {
    std::string kind;
    std::string name;
    std::map<std::string, std::string> props;
  };
  virtual ~Recipe() = default;
  virtual std::vector<Part> resources(const std::string& name) const = 0;
  virtual std::vector<std::pair<std::string, std::string>> links(const std::string& name) const = 0;
};

class WebRecipe : public Recipe {
 public:
  std::vector<Part> resources(const std::string& name) const override {
    return {{"balancer", name + "-lb", {{"port", "443"}}},
            {"service", name + "-app", {{"image", name + ":latest"}, {"port", "8080"}}},
            {"database", name + "-db", {{"engine", "postgres"}, {"size", "small"}}}};
  }
  std::vector<std::pair<std::string, std::string>> links(const std::string& name) const override {
    return {{name + "-lb", name + "-app"}, {name + "-app", name + "-db"}};
  }
};

class WorkerRecipe : public Recipe {
 public:
  std::vector<Part> resources(const std::string& name) const override {
    return {{"queue", name + "-jobs", {{"region", "us-east-1"}}},
            {"worker", name + "-worker", {{"image", name + ":latest"}}}};
  }
  std::vector<std::pair<std::string, std::string>> links(const std::string& name) const override {
    return {{name + "-worker", name + "-jobs"}};
  }
};

// A builder: resources and dependencies accumulate step by step, by hand or a recipe at a
// time, and nothing is ordered until the plan is asked for. Dependencies never form a
// cycle, because a link that would close one is refused when it's added.
class StackBuilder {
 public:
  explicit StackBuilder(std::string name) : stack_(name) { given(name); }

  bool resource(std::string kind, std::string name, std::map<std::string, std::string> props) {
    if (!required().count(kind)) throw std::invalid_argument("unknown kind");
    given(name);
    for (const auto& [key, value] : props) {
      given(key);
      given(value);
    }
    if (resources_.count(name)) return false;
    resources_[name] = Resource{kind, name, props, {}, {}};
    return true;
  }

  bool dependsOn(std::string a, std::string b) {
    Resource& first = known(a);
    Resource& second = known(b);
    if (a == b) throw std::invalid_argument("a resource can't depend on itself");
    if (std::find(first.needs.begin(), first.needs.end(), b) != first.needs.end() || reachable(b).count(a))
      return false;
    first.needs.push_back(b);
    second.neededBy.push_back(a);
    return true;
  }

  int64_t preset(std::string recipe, std::string name) {
    static const std::map<std::string, std::shared_ptr<Recipe>> recipes = {
        {"web", std::make_shared<WebRecipe>()}, {"worker", std::make_shared<WorkerRecipe>()}};
    auto found = recipes.find(recipe);
    if (found == recipes.end()) throw std::invalid_argument("unknown recipe");
    given(name);
    auto parts = found->second->resources(name);
    for (const auto& part : parts)
      if (resources_.count(part.name)) return 0;
    for (const auto& part : parts) resource(part.kind, part.name, part.props);
    for (const auto& [a, b] : found->second->links(name)) dependsOn(a, b);
    return static_cast<int64_t>(parts.size());
  }

  std::vector<std::string> validate() {
    std::vector<std::string> problems;
    for (const auto& [name, r] : resources_)
      for (const auto& prop : required().at(r.kind))
        if (!r.props.count(prop)) problems.push_back(name + ": missing " + prop);
    std::sort(problems.begin(), problems.end());
    return problems;
  }

  std::vector<std::string> plan() {
    if (!validate().empty()) throw std::invalid_argument("the stack isn't valid");
    return order([](const Resource& r) { return r.needs; }, [](const Resource& r) { return r.neededBy; });
  }

  // The extension round: tearing the stack down.
  std::vector<std::string> destroyPlan() {
    return order([](const Resource& r) { return r.neededBy; }, [](const Resource& r) { return r.needs; });
  }

 private:
  struct Resource {
    std::string kind;
    std::string name;
    std::map<std::string, std::string> props;
    std::vector<std::string> needs;     // resources this one depends on
    std::vector<std::string> neededBy;  // resources that depend on this one
  };
  using Links = std::function<std::vector<std::string>(const Resource&)>;

  // Each kind's required properties.
  static const std::map<std::string, std::vector<std::string>>& required() {
    static const std::map<std::string, std::vector<std::string>> kinds = {
        {"bucket", {"region"}},           {"queue", {"region"}},         {"database", {"engine", "size"}},
        {"service", {"image", "port"}}, {"worker", {"image"}}, {"balancer", {"port"}}};
    return kinds;
  }

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }

  Resource& known(const std::string& name) {
    auto found = resources_.find(name);
    if (found == resources_.end()) throw std::invalid_argument("unknown resource");
    return found->second;
  }

  // Every resource `start` depends on, directly or not.
  std::set<std::string> reachable(const std::string& start) {
    std::set<std::string> seen{start};
    std::vector<std::string> reached{start};
    for (size_t i = 0; i < reached.size(); i++)
      for (const auto& need : resources_.at(reached[i]).needs)
        if (seen.insert(need).second) reached.push_back(need);
    return seen;
  }

  // Kahn's algorithm: a resource comes once everything `before` it has, and among those
  // ready, the smallest name goes first.
  std::vector<std::string> order(const Links& before, const Links& after) {
    std::map<std::string, size_t> waiting;
    std::set<std::string> ready;
    for (const auto& [name, r] : resources_) {
      waiting[name] = before(r).size();
      if (waiting[name] == 0) ready.insert(name);
    }
    std::vector<std::string> out;
    for (size_t i = 0; i < resources_.size(); i++) {
      const Resource& resource = resources_.at(*ready.begin());
      ready.erase(ready.begin());
      out.push_back(resource.kind + " " + stack_ + "/" + resource.name);
      for (const auto& name : after(resource))
        if (--waiting[name] == 0) ready.insert(name);
    }
    return out;
  }

  std::string stack_;
  std::map<std::string, Resource> resources_;
};
