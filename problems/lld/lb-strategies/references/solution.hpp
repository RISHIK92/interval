#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Picks a backend for each new connection with a strategy that can be swapped at
// runtime. The balancer owns the backends and their connection counts; a strategy owns
// only its own position, so a new one starts fresh and loses no connections.
class Balancer {
 public:
  explicit Balancer(std::string strategy) : strategy_(fresh(strategy)) {}

  void addBackend(std::string name, int64_t weight) {
    if (name.empty() || byName_.count(name) > 0 || weight < 1 || weight > kMaxWeight)
      throw std::invalid_argument("bad backend");
    backends_.push_back(std::make_shared<Backend>(Backend{name, weight, 0, false}));
    byName_[name] = backends_.back();
  }

  std::string pick() {
    Backend& backend = strategy_->choose(backends_);
    backend.open += 1;
    return backend.name;
  }

  void done(std::string backend) {
    Backend& found = find(backend);
    if (found.open == 0) throw std::invalid_argument("no open connection");
    found.open -= 1;
  }

  void useStrategy(std::string strategy) { strategy_ = fresh(strategy); }

  // The extension round: taking a backend out of rotation.
  void drain(std::string backend) {
    Backend& found = find(backend);
    if (found.drained) throw std::invalid_argument("already drained");
    found.drained = true;
  }

 private:
  static constexpr int64_t kMaxWeight = 100;

  struct Backend {
    std::string name;
    int64_t weight;
    int64_t open;
    bool drained;
  };
  using Backends = std::vector<std::shared_ptr<Backend>>;

  struct Strategy {
    virtual ~Strategy() = default;
    virtual Backend& choose(const Backends& backends) = 0;
  };

  // The backend after the one picked last, in the order they were added, wrapping.
  struct RoundRobin : Strategy {
    int64_t last = -1;
    Backend& choose(const Backends& backends) override {
      int64_t count = static_cast<int64_t>(backends.size());
      for (int64_t step = 0; step < count; step++) {
        int64_t at = (last + 1 + step) % count;
        if (!backends[at]->drained) {
          last = at;
          return *backends[at];
        }
      }
      throw std::invalid_argument("no backend to pick");
    }
  };

  // The backend with the fewest open connections; a tie goes to the one added first.
  struct LeastConnections : Strategy {
    Backend& choose(const Backends& backends) override {
      Backend* best = nullptr;
      for (const auto& backend : backends)
        if (!backend->drained && (best == nullptr || backend->open < best->open)) best = backend.get();
      if (best == nullptr) throw std::invalid_argument("no backend to pick");
      return *best;
    }
  };

  // Smooth weighted round robin: every pick, each backend's current weight grows by its
  // weight, the largest is picked (a tie goes to the one added first), and the pick
  // gives back the total, so heavy backends are spread out instead of picked in a row.
  struct SmoothWeighted : Strategy {
    std::map<std::string, int64_t> current;
    Backend& choose(const Backends& backends) override {
      Backend* best = nullptr;
      int64_t total = 0;
      for (const auto& backend : backends) {
        if (backend->drained) continue;
        total += backend->weight;
        current[backend->name] += backend->weight;
        if (best == nullptr || current[backend->name] > current[best->name]) best = backend.get();
      }
      if (best == nullptr) throw std::invalid_argument("no backend to pick");
      current[best->name] -= total;
      return *best;
    }
  };

  static std::unique_ptr<Strategy> fresh(const std::string& strategy) {
    static const std::map<std::string, std::function<std::unique_ptr<Strategy>()>> strategies = {
        {"round-robin", [] { return std::make_unique<RoundRobin>(); }},
        {"least-connections", [] { return std::make_unique<LeastConnections>(); }},
        {"weighted-round-robin", [] { return std::make_unique<SmoothWeighted>(); }},
    };
    auto make = strategies.find(strategy);
    if (make == strategies.end()) throw std::invalid_argument("unknown strategy");
    return make->second();
  }

  Backend& find(const std::string& name) {
    auto found = byName_.find(name);
    if (found == byName_.end()) throw std::invalid_argument("unknown backend");
    return *found->second;
  }

  Backends backends_;
  std::map<std::string, std::shared_ptr<Backend>> byName_;
  std::unique_ptr<Strategy> strategy_;
};
