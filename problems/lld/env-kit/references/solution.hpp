#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

// An abstract factory: one family's way of making each kind of component. The kit only
// ever asks the family in use, so every component it makes belongs together.
class Family {
 public:
  virtual ~Family() = default;
  virtual std::string name() const = 0;
  virtual std::string queue() const = 0;
  virtual std::string store() const = 0;
  virtual std::string clock() const = 0;
};

class LocalFamily : public Family {
 public:
  std::string name() const override { return "local"; }
  std::string queue() const override { return "inmem-queue"; }
  std::string store() const override { return "sqlite-store"; }
  std::string clock() const override { return "fake-clock"; }
};

class CiFamily : public Family {
 public:
  std::string name() const override { return "ci"; }
  std::string queue() const override { return "valkey-queue"; }
  std::string store() const override { return "postgres-store"; }
  std::string clock() const override { return "fixed-clock"; }
};

class StagingFamily : public Family {
 public:
  std::string name() const override { return "staging"; }
  std::string queue() const override { return "sqs-queue"; }
  std::string store() const override { return "rds-store"; }
  std::string clock() const override { return "system-clock"; }
};

// A family defined at run time: its components are named after its prefix.
class PrefixedFamily : public Family {
 public:
  PrefixedFamily(std::string name, std::string prefix) : name_(std::move(name)), prefix_(std::move(prefix)) {}
  std::string name() const override { return name_; }
  std::string queue() const override { return prefix_ + "-queue"; }
  std::string store() const override { return prefix_ + "-store"; }
  std::string clock() const override { return prefix_ + "-clock"; }

 private:
  std::string name_;
  std::string prefix_;
};

class EnvKit {
 public:
  EnvKit() {
    add(std::make_shared<LocalFamily>());
    add(std::make_shared<CiFamily>());
    add(std::make_shared<StagingFamily>());
  }

  void use(std::string family) {
    auto found = families_.find(family);
    if (found == families_.end()) throw std::invalid_argument("unknown family");
    current_ = found->second;
  }

  std::string component(std::string kind) {
    // Each kind is one of the factory's methods; the kit never names a concrete family.
    static const std::map<std::string, std::function<std::string(const Family&)>> kinds = {
        {"queue", [](const Family& f) { return f.queue(); }},
        {"store", [](const Family& f) { return f.store(); }},
        {"clock", [](const Family& f) { return f.clock(); }},
    };
    auto make = kinds.find(kind);
    if (make == kinds.end()) throw std::invalid_argument("unknown kind");
    if (!current_) throw std::invalid_argument("no family in use");
    std::string id = make->second(*current_) + "#" + std::to_string(made_.size() + 1);
    made_[id] = current_->name();
    return id;
  }

  bool wire(std::string a, std::string b) {
    if (a == b) throw std::invalid_argument("a component can't be wired to itself");
    return family(a) == family(b);
  }

  std::string family(std::string componentId) {
    auto found = made_.find(componentId);
    if (found == made_.end()) throw std::invalid_argument("unknown component");
    return found->second;
  }

  // The extension round: a family that isn't built in.
  void defineFamily(std::string name, std::string prefix) {
    if (name.empty() || prefix.empty()) throw std::invalid_argument("empty");
    if (families_.count(name)) throw std::invalid_argument("family exists");
    add(std::make_shared<PrefixedFamily>(name, prefix));
  }

 private:
  void add(std::shared_ptr<Family> family) { families_[family->name()] = family; }

  std::map<std::string, std::shared_ptr<Family>> families_;
  std::shared_ptr<Family> current_;
  std::map<std::string, std::string> made_;  // component id -> family name
};
