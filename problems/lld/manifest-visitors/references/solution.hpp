#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

class Deployment;
class Service;
class ConfigMap;

// One operation over every kind. A new operation is a new visitor; the manifest classes
// never change for it.
class Visitor {
 public:
  virtual ~Visitor() = default;
  virtual void visit(const Deployment& d) = 0;
  virtual void visit(const Service& s) = 0;
  virtual void visit(const ConfigMap& c) = 0;
  virtual std::vector<std::string> finish() { return lines; }

 protected:
  std::vector<std::string> lines;
};

using Fields = std::map<std::string, int64_t>;

class Manifest {
 public:
  explicit Manifest(std::string name) : name(std::move(name)) {}
  virtual ~Manifest() = default;
  virtual void accept(Visitor& v) const = 0;
  const std::string name;
};

static std::optional<int64_t> field(const Fields& f, const std::string& key) {
  auto at = f.find(key);
  if (at == f.end()) return std::nullopt;
  return at->second;
}

class Deployment : public Manifest {
 public:
  Deployment(std::string name, const Fields& f)
      : Manifest(std::move(name)),
        replicas(f.at("replicas")),
        cpu(field(f, "cpu")),
        memory(field(f, "memory")),
        privileged(field(f, "privileged") == 1) {}
  void accept(Visitor& v) const override { v.visit(*this); }

  const int64_t replicas;
  const std::optional<int64_t> cpu, memory;
  const bool privileged;
};

class Service : public Manifest {
 public:
  Service(std::string name, const Fields& f)
      : Manifest(std::move(name)), port(f.at("port")), isPublic(field(f, "public") == 1) {}
  void accept(Visitor& v) const override { v.visit(*this); }

  const int64_t port;
  const bool isPublic;
};

class ConfigMap : public Manifest {
 public:
  ConfigMap(std::string name, const Fields& f)
      : Manifest(std::move(name)), entries(f.at("entries")), secrets(field(f, "secrets").value_or(0)) {}
  void accept(Visitor& v) const override { v.visit(*this); }

  const int64_t entries, secrets;
};

class Inventory : public Visitor {
 public:
  void visit(const Deployment& d) override {
    lines.push_back("deployment/" + d.name + " replicas=" + std::to_string(d.replicas));
  }
  void visit(const Service& s) override { lines.push_back("service/" + s.name + " port=" + std::to_string(s.port)); }
  void visit(const ConfigMap& c) override {
    lines.push_back("configmap/" + c.name + " entries=" + std::to_string(c.entries));
  }
};

class Lint : public Visitor {
 public:
  void visit(const Deployment& d) override {
    if (d.replicas == 1) lines.push_back("deployment/" + d.name + ": single replica");
    if (!d.cpu) lines.push_back("deployment/" + d.name + ": no cpu limit");
  }
  void visit(const Service&) override {}  // nothing about a service is linted yet
  void visit(const ConfigMap& c) override {
    if (c.entries == 0) lines.push_back("configmap/" + c.name + ": empty");
  }
};

class Cost : public Visitor {
 public:
  static constexpr int64_t kLoadBalancer = 20;

  void visit(const Deployment& d) override {
    add("deployment/" + d.name, d.replicas * (d.cpu.value_or(0) + d.memory.value_or(0)));
  }
  void visit(const Service& s) override { add("service/" + s.name, s.isPublic ? kLoadBalancer : 0); }
  void visit(const ConfigMap& c) override { add("configmap/" + c.name, 0); }
  std::vector<std::string> finish() override {
    auto out = lines;
    out.push_back("total " + std::to_string(total_));
    return out;
  }

 private:
  void add(const std::string& what, int64_t cost) {
    lines.push_back(what + " " + std::to_string(cost));
    total_ += cost;
  }
  int64_t total_ = 0;
};

class SecurityAudit : public Visitor {
 public:
  void visit(const Deployment& d) override {
    if (d.privileged) lines.push_back("deployment/" + d.name + ": privileged");
  }
  void visit(const Service& s) override {
    if (s.isPublic) lines.push_back("service/" + s.name + ": public");
  }
  void visit(const ConfigMap& c) override {
    if (c.secrets > 0) lines.push_back("configmap/" + c.name + ": plain-text secrets");
  }
};

class ManifestSet {
 public:
  bool addResource(std::string kind, std::string name, Fields fields) {
    auto spec = kinds_().find(kind);
    if (spec == kinds_().end() || name.empty()) throw std::invalid_argument("unknown kind or empty name");
    const auto& allowed = spec->second.fields;
    for (const auto& [key, value] : fields) {
      auto range = allowed.find(key);
      if (range == allowed.end()) throw std::invalid_argument("unknown field");
      if (value < range->second.low || value > range->second.high) throw std::invalid_argument("value out of range");
    }
    for (const auto& [key, range] : allowed)
      if (range.required && !fields.count(key)) throw std::invalid_argument("missing field");
    if (!names_[kind].insert(name).second) return false;
    items_.push_back(spec->second.make(name, fields));
    return true;
  }

  std::vector<std::string> runVisitor(std::string visitor) {
    if (visitor == "inventory") return walk(std::make_unique<Inventory>());
    if (visitor == "lint") return walk(std::make_unique<Lint>());
    if (visitor == "cost") return walk(std::make_unique<Cost>());
    throw std::invalid_argument("unknown visitor");
  }

  std::vector<std::string> kinds() {
    std::vector<std::string> out;
    for (const auto& [kind, names] : names_) out.push_back(kind);
    return out;
  }

  // The extension round: a fourth operation, and no manifest class changes.
  std::vector<std::string> securityAudit() { return walk(std::make_unique<SecurityAudit>()); }

 private:
  // Per kind: each field with its least and greatest value, and whether it is required.
  struct Range {
    int64_t low, high;
    bool required;
  };
  struct Kind {
    std::function<std::unique_ptr<Manifest>(const std::string&, const Fields&)> make;
    std::map<std::string, Range> fields;
  };

  static const std::map<std::string, Kind>& kinds_() {
    static constexpr int64_t kMost = 1000000;
    static const Range flag{0, 1, false};
    static const std::map<std::string, Kind> all = {
        {"deployment",
         {[](const std::string& n, const Fields& f) { return std::make_unique<Deployment>(n, f); },
          {{"replicas", {0, kMost, true}}, {"cpu", {1, kMost, false}}, {"memory", {1, kMost, false}},
           {"privileged", flag}}}},
        {"service",
         {[](const std::string& n, const Fields& f) { return std::make_unique<Service>(n, f); },
          {{"port", {1, 65535, true}}, {"public", flag}}}},
        {"configmap",
         {[](const std::string& n, const Fields& f) { return std::make_unique<ConfigMap>(n, f); },
          {{"entries", {0, kMost, true}}, {"secrets", {0, kMost, false}}}}},
    };
    return all;
  }

  std::vector<std::string> walk(std::unique_ptr<Visitor> v) {
    for (const auto& item : items_) item->accept(*v);
    return v->finish();
  }

  std::vector<std::unique_ptr<Manifest>> items_;
  std::map<std::string, std::set<std::string>> names_;
};
