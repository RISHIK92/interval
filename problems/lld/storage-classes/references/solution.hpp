#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>

// Fees charged and restores made so far, by reads and (in the extension) moves.
struct StorageMeter {
  int64_t fees = 0;
  int64_t restores = 0;
};

class StorageClass;

struct StoredObject {
  std::string data;
  const StorageClass* storageClass;
  bool restored = false;
};

// Every class keeps the same promise: read hands back exactly what was stored. They differ
// only in what that costs, so the bucket never asks which class an object is in.
class StorageClass {
 public:
  virtual ~StorageClass() = default;
  virtual int64_t rate() const = 0;
  virtual std::string read(StoredObject& stored, StorageMeter& meter) const = 0;
  virtual void leave(StoredObject&, StorageMeter&) const {}
};

class StandardClass : public StorageClass {
 public:
  int64_t rate() const override { return 4; }
  std::string read(StoredObject& stored, StorageMeter&) const override { return stored.data; }
};

class InfrequentAccessClass : public StorageClass {
 public:
  int64_t rate() const override { return 2; }
  std::string read(StoredObject& stored, StorageMeter& meter) const override {
    meter.fees += static_cast<int64_t>(stored.data.size());
    return stored.data;
  }
};

// Slow to reach, never absent: the first read restores the object, and pays for it,
// instead of failing or answering null.
class ArchiveClass : public StorageClass {
 public:
  int64_t rate() const override { return 1; }
  std::string read(StoredObject& stored, StorageMeter& meter) const override {
    leave(stored, meter);
    return stored.data;
  }
  void leave(StoredObject& stored, StorageMeter& meter) const override {
    if (stored.restored) return;
    meter.restores += 1;
    meter.fees += 3 * static_cast<int64_t>(stored.data.size());
    stored.restored = true;
  }
};

class StorageBucket {
 public:
  StorageBucket() = default;

  void store(std::string key, std::string data, std::string storageClass) {
    named(key);
    const StorageClass* target = classNamed(storageClass);
    objects_[key] = StoredObject{data, target};
  }

  std::optional<std::string> read(std::string key) {
    named(key);
    auto found = objects_.find(key);
    if (found == objects_.end()) return std::nullopt;
    return found->second.storageClass->read(found->second, meter_);
  }

  int64_t restores() { return meter_.restores; }

  int64_t monthlyCost() {
    int64_t keeping = 0;
    for (const auto& [_, s] : objects_) keeping += s.storageClass->rate() * static_cast<int64_t>(s.data.size());
    return keeping + meter_.fees;
  }

  // The extension round: a lifecycle move, which each class leaves in its own way.
  bool transition(std::string key, std::string storageClass) {
    named(key);
    const StorageClass* target = classNamed(storageClass);
    auto found = objects_.find(key);
    if (found == objects_.end() || found->second.storageClass == target) return false;
    found->second.storageClass->leave(found->second, meter_);
    found->second = StoredObject{found->second.data, target};
    return true;
  }

 private:
  static void named(const std::string& key) {
    if (key.empty()) throw std::invalid_argument("empty key");
  }

  static const StorageClass* classNamed(const std::string& name) {
    static const StandardClass standard;
    static const InfrequentAccessClass infrequent;
    static const ArchiveClass archive;
    static const std::map<std::string, const StorageClass*> classes{
        {"standard", &standard}, {"infrequent-access", &infrequent}, {"archive", &archive}};
    auto found = classes.find(name);
    if (found == classes.end()) throw std::invalid_argument("unknown storage class");
    return found->second;
  }

  std::map<std::string, StoredObject> objects_;
  StorageMeter meter_;
};
