#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// What the store needs from where blobs are kept. Callers only see BlobStore, so which
// backend is behind it never shows in their code.
class Backend {
 public:
  virtual ~Backend() = default;
  virtual int64_t put(const std::string& key, const std::string& data) = 0;
  virtual std::optional<std::string> latest(const std::string& key) const = 0;
  virtual std::optional<std::string> version(const std::string& key, int64_t version) const = 0;
  virtual bool remove(const std::string& key) = 0;
  virtual std::vector<std::string> keys() const = 0;
};

// Keeps only the latest blob of each key, and counts the puts to number it.
class PlainBackend : public Backend {
 public:
  int64_t put(const std::string& key, const std::string& data) override {
    auto found = blobs_.find(key);
    int64_t number = found == blobs_.end() ? 1 : found->second.first + 1;
    blobs_[key] = {number, data};
    return number;
  }
  std::optional<std::string> latest(const std::string& key) const override {
    auto found = blobs_.find(key);
    if (found == blobs_.end()) return std::nullopt;
    return found->second.second;
  }
  std::optional<std::string> version(const std::string& key, int64_t version) const override {
    auto found = blobs_.find(key);
    if (found == blobs_.end() || found->second.first != version) return std::nullopt;
    return found->second.second;
  }
  bool remove(const std::string& key) override { return blobs_.erase(key) > 0; }
  std::vector<std::string> keys() const override {
    std::vector<std::string> out;
    for (const auto& [k, _] : blobs_) out.push_back(k);
    return out;
  }

 private:
  std::map<std::string, std::pair<int64_t, std::string>> blobs_;
};

// Keeps every blob each key has had, oldest first.
class VersionedBackend : public Backend {
 public:
  int64_t put(const std::string& key, const std::string& data) override {
    auto& found = history_[key];
    found.push_back(data);
    return static_cast<int64_t>(found.size());
  }
  std::optional<std::string> latest(const std::string& key) const override {
    auto found = history_.find(key);
    if (found == history_.end()) return std::nullopt;
    return found->second.back();
  }
  std::optional<std::string> version(const std::string& key, int64_t version) const override {
    auto found = history_.find(key);
    if (found == history_.end() || version > static_cast<int64_t>(found->second.size())) return std::nullopt;
    return found->second[version - 1];
  }
  bool remove(const std::string& key) override { return history_.erase(key) > 0; }
  std::vector<std::string> keys() const override {
    std::vector<std::string> out;
    for (const auto& [k, _] : history_) out.push_back(k);
    return out;
  }

 private:
  std::map<std::string, std::vector<std::string>> history_;
};

class BlobStore {
 public:
  explicit BlobStore(std::string backend) : kind_(backend), backend_(open(backend)) {}

  int64_t putBlob(std::string key, std::string data) {
    named(key);
    return backend_->put(key, data);
  }

  std::optional<std::string> fetch(std::string key) {
    named(key);
    return backend_->latest(key);
  }

  bool remove(std::string key) {
    named(key);
    return backend_->remove(key);
  }

  std::vector<std::string> listKeys(std::string prefix) {
    std::vector<std::string> out;
    for (const auto& k : backend_->keys())
      if (k.compare(0, prefix.size(), prefix) == 0) out.push_back(k);
    std::sort(out.begin(), out.end());
    return out;
  }

  int64_t migrate(std::string backend) {
    if (backend == kind_) throw std::invalid_argument("already on that backend");
    auto target = open(backend);
    auto keys = backend_->keys();
    for (const auto& key : keys) target->put(key, *backend_->latest(key));  // every listed key has a latest blob
    kind_ = backend;
    backend_ = std::move(target);
    return static_cast<int64_t>(keys.size());
  }

  // The extension round: one more question for every backend, answered its own way.
  std::optional<std::string> fetchVersion(std::string key, int64_t version) {
    named(key);
    if (version < 1) throw std::invalid_argument("versions start at 1");
    return backend_->version(key, version);
  }

 private:
  static std::unique_ptr<Backend> open(const std::string& kind) {
    if (kind == "plain") return std::make_unique<PlainBackend>();
    if (kind == "versioned") return std::make_unique<VersionedBackend>();
    throw std::invalid_argument("unknown backend");
  }

  static void named(const std::string& key) {
    if (key.empty()) throw std::invalid_argument("keys are not empty");
  }

  std::string kind_;
  std::unique_ptr<Backend> backend_;
};
