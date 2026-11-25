#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A pod owns its containers: they are created inside it and go with it.
class PodRegistry {
 public:
  PodRegistry() {}

  void createPod(std::string pod) {
    named(pod);
    if (pods_.count(pod) > 0) throw std::invalid_argument("pod already exists");
    std::vector<std::pair<std::string, std::string>> injected;
    for (const auto& [name, image] : sidecars_) injected.emplace_back(pod + "-" + name, image);
    for (const auto& [name, image] : injected)
      if (podOf_.count(name) > 0) throw std::invalid_argument("a sidecar's name is taken");
    pods_[pod];
    for (const auto& [name, image] : injected) place(pod, name, image);
  }

  bool addContainer(std::string pod, std::string container, std::string image) {
    named(pod);
    named(container);
    named(image);
    if (pods_.count(pod) == 0 || podOf_.count(container) > 0) return false;
    place(pod, container, image);
    return true;
  }

  int64_t removePod(std::string pod) {
    named(pod);
    auto it = pods_.find(pod);
    if (it == pods_.end()) throw std::invalid_argument("unknown pod");
    for (const auto& [container, image] : it->second) podOf_.erase(container);
    int64_t removed = static_cast<int64_t>(it->second.size());
    pods_.erase(it);
    return removed;
  }

  std::optional<std::string> podOf(std::string container) {
    named(container);
    auto it = podOf_.find(container);
    if (it == podOf_.end()) return std::nullopt;
    return it->second;
  }

  std::vector<std::string> images() {
    std::set<std::string> all;
    for (const auto& [pod, owned] : pods_)
      for (const auto& [container, image] : owned) all.insert(image);
    return {all.begin(), all.end()};
  }

  // The extension round: containers injected into every pod created afterwards.
  void sidecar(std::string container, std::string image) {
    named(container);
    named(image);
    if (sidecars_.count(container) > 0) throw std::invalid_argument("sidecar already registered");
    sidecars_[container] = image;
  }

 private:
  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("names and images are not empty");
  }

  void place(const std::string& pod, const std::string& container, const std::string& image) {
    pods_[pod][container] = image;
    podOf_[container] = pod;
  }

  std::map<std::string, std::map<std::string, std::string>> pods_;
  std::map<std::string, std::string> podOf_;
  std::map<std::string, std::string> sidecars_;
};
