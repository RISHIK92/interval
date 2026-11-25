#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace volume_drivers {

constexpr int64_t kMaxSizeGb = 65536;
const std::set<std::string> kOps = {"snapshot", "resize", "encrypt"};

struct Volume {
  std::string name;
  int64_t size;
  // Each snapshot id and the size it recorded, oldest first.
  std::vector<std::pair<std::string, int64_t>> snapshots;
};

// Each operation is its own narrow capability. A driver holds only the ones it has, so the
// manager can't call an operation a driver lacks: it finds no capability and fails.
struct Snapshots {
  std::string take(Volume& volume) const {
    std::string snapshot = volume.name + "@" + std::to_string(volume.snapshots.size() + 1);
    volume.snapshots.emplace_back(snapshot, volume.size);
    return snapshot;
  }

  bool restore(Volume& volume, const std::string& snapshot) const {
    for (const auto& [id, size] : volume.snapshots)
      if (id == snapshot) {
        volume.size = size;
        return true;
      }
    return false;
  }
};

struct Resizing {
  bool grow(Volume& volume, int64_t size) const {
    if (size <= volume.size) return false;
    volume.size = size;
    return true;
  }
};

// "encrypt" is a known operation, but no call here needs it, so it has no capability yet.
struct Driver {
  std::shared_ptr<Snapshots> snapshots;
  std::shared_ptr<Resizing> resizing;

  explicit Driver(const std::vector<std::string>& ops) {
    std::set<std::string> distinct(ops.begin(), ops.end());
    if (distinct.size() != ops.size())
      throw std::invalid_argument("ops are distinct, from snapshot, resize and encrypt");
    for (const std::string& op : ops)
      if (kOps.count(op) == 0) throw std::invalid_argument("ops are distinct, from snapshot, resize and encrypt");
    if (distinct.count("snapshot") > 0) snapshots = std::make_shared<Snapshots>();
    if (distinct.count("resize") > 0) resizing = std::make_shared<Resizing>();
  }
};

inline const std::string& named(const std::string& text) {
  if (text.empty()) throw std::invalid_argument("an empty name");
  return text;
}

inline int64_t sized(int64_t sizeGb) {
  if (sizeGb < 1 || sizeGb > kMaxSizeGb) throw std::invalid_argument("a size is 1 to 65536 GB");
  return sizeGb;
}

struct Entry {
  Volume volume;
  std::shared_ptr<Driver> driver;
};

}  // namespace volume_drivers

class VolumeManager {
 public:
  VolumeManager() {}

  void driver(std::string name, std::vector<std::string> ops) {
    if (drivers_.count(volume_drivers::named(name)) > 0)
      throw std::invalid_argument("a driver is registered once");
    drivers_[name] = std::make_shared<volume_drivers::Driver>(ops);
  }

  bool create(std::string volume, std::string driver, int64_t sizeGb) {
    volume_drivers::named(volume);
    auto it = drivers_.find(driver);
    if (it == drivers_.end()) throw std::invalid_argument("an unknown driver");
    int64_t size = volume_drivers::sized(sizeGb);
    if (volumes_.count(volume) > 0) return false;
    volumes_[volume] = {{volume, size, {}}, it->second};
    return true;
  }

  std::string snapshot(std::string volume) {
    auto [found, snapshots] = snapshotting(volume);
    return snapshots.take(found);
  }

  bool resize(std::string volume, int64_t sizeGb) {
    volume_drivers::Entry& entry = find(volume);
    if (!entry.driver->resizing) throw std::invalid_argument("the driver can't resize");
    return entry.driver->resizing->grow(entry.volume, volume_drivers::sized(sizeGb));
  }

  std::vector<std::string> snapshots(std::string volume) {
    std::vector<std::string> out;
    for (const auto& [id, size] : snapshotting(volume).first.snapshots) out.push_back(id);
    return out;
  }

  // The extension round.
  bool restore(std::string volume, std::string snapshot) {
    auto [found, snapshots] = snapshotting(volume);
    return snapshots.restore(found, volume_drivers::named(snapshot));
  }

 private:
  volume_drivers::Entry& find(const std::string& volume) {
    auto it = volumes_.find(volume);
    if (it == volumes_.end()) throw std::invalid_argument("an unknown volume");
    return it->second;
  }

  std::pair<volume_drivers::Volume&, const volume_drivers::Snapshots&> snapshotting(const std::string& volume) {
    volume_drivers::Entry& entry = find(volume);
    if (!entry.driver->snapshots) throw std::invalid_argument("the driver can't snapshot");
    return {entry.volume, *entry.driver->snapshots};
  }

  std::map<std::string, std::shared_ptr<volume_drivers::Driver>> drivers_;
  std::map<std::string, volume_drivers::Entry> volumes_;
};
