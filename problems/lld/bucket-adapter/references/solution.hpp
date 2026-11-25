#pragma once
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// The old flat key-value store: no buckets, no folders, just keys.
class LegacyStore {
 public:
  void put(const std::string& key, const std::string& value) { data_[key] = value; }

  std::optional<std::string> read(const std::string& key) const {
    auto it = data_.find(key);
    if (it == data_.end()) return std::nullopt;
    return it->second;
  }

  std::vector<std::string> scan(const std::string& prefix) const {
    std::vector<std::string> keys;
    for (auto it = data_.lower_bound(prefix); it != data_.end() && it->first.rfind(prefix, 0) == 0; ++it)
      keys.push_back(it->first);
    return keys;
  }

 private:
  std::map<std::string, std::string> data_;
};

// Gives the legacy store a bucket-and-key API. The encoding is the adapter's alone: an
// object lives at `<bucket>:<key>`, and a bucket never holds a `:`, so the first one
// splits them.
class BucketAdapter {
 public:
  void putObject(std::string bucket, std::string key, std::string body) {
    checkBucket(bucket);
    given(key);
    given(body);
    store_.put(legacy(bucket, key), body);
  }

  std::optional<std::string> objectBody(std::string bucket, std::string key) {
    checkBucket(bucket);
    given(key);
    return store_.read(legacy(bucket, key));
  }

  std::vector<std::string> listObjects(std::string bucket, std::string prefix, std::string delimiter) {
    checkBucket(bucket);
    std::set<std::string> found;
    for (const auto& stored : store_.scan(legacy(bucket, prefix))) {
      std::string key = stored.substr(bucket.size() + 1);
      // S3's common prefixes: what follows the prefix, up to its first delimiter.
      size_t cut = key.find(delimiter, prefix.size());
      if (!delimiter.empty() && cut != std::string::npos) key = key.substr(0, cut + delimiter.size());
      found.insert(key);
    }
    return {found.begin(), found.end()};
  }

  std::vector<std::string> legacyKeys() { return store_.scan(""); }

  // The extension round: a copy, through the same encoding.
  bool copyObject(std::string bucket, std::string key, std::string toBucket, std::string toKey) {
    checkBucket(bucket);
    given(key);
    checkBucket(toBucket);
    given(toKey);
    std::optional<std::string> body = store_.read(legacy(bucket, key));
    if (!body) return false;
    store_.put(legacy(toBucket, toKey), *body);
    return true;
  }

 private:
  LegacyStore store_;

  static std::string legacy(const std::string& bucket, const std::string& key) { return bucket + ":" + key; }

  static void checkBucket(const std::string& bucket) {
    if (bucket.empty() || bucket.find(':') != std::string::npos) throw std::invalid_argument("bad bucket");
  }

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }
};
