#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>

// The one loaded copy of the settings. Only the holder creates it, and only when
// something first needs a setting.
struct Settings {
  explicit Settings(std::map<std::string, std::string> source) : entries(std::move(source)) {}
  const std::map<std::string, std::string> entries;
};

class SettingsHolder {
 public:
  explicit SettingsHolder(std::map<std::string, std::string> defaults) {
    for (const auto& [key, value] : defaults) {
      filled(key);
      filled(value);
    }
    source_ = std::move(defaults);
  }

  std::optional<std::string> value(std::string key) {
    filled(key);
    auto loaded = instance();
    std::lock_guard<std::mutex> guard(mutex_);
    auto overridden = overrides_.find(key);
    if (overridden != overrides_.end()) return overridden->second;
    auto found = loaded->entries.find(key);
    if (found == loaded->entries.end()) return std::nullopt;
    return found->second;
  }

  int64_t loads() {
    std::lock_guard<std::mutex> guard(mutex_);
    return loads_;
  }

  void overrideKey(std::string key, std::string value) {
    filled(key);
    filled(value);
    std::lock_guard<std::mutex> guard(mutex_);
    overrides_[key] = value;
  }

  void reload() {
    std::lock_guard<std::mutex> guard(mutex_);
    settings_.reset();
    overrides_.clear();
  }

  // The extension round: a view of one prefix, read through the same single instance.
  std::map<std::string, std::string> scoped(std::string prefix) {
    filled(prefix);
    auto loaded = instance();
    std::lock_guard<std::mutex> guard(mutex_);
    std::map<std::string, std::string> merged = loaded->entries;
    for (const auto& [k, v] : overrides_) merged[k] = v;
    std::map<std::string, std::string> out;
    for (const auto& [k, v] : merged)
      if (k.compare(0, prefix.size(), prefix) == 0) out[k] = v;
    return out;
  }

 private:
  static void filled(const std::string& text) {
    if (text.empty()) throw std::invalid_argument("keys and values are not empty");
  }

  // Every reader goes through here; the lock makes "load once" hold even when many
  // threads ask for their first setting together.
  std::shared_ptr<const Settings> instance() {
    std::lock_guard<std::mutex> guard(mutex_);
    if (!settings_) {
      settings_ = std::make_shared<const Settings>(source_);
      loads_ += 1;
    }
    return settings_;
  }

  std::map<std::string, std::string> source_;
  std::map<std::string, std::string> overrides_;
  std::shared_ptr<const Settings> settings_;
  int64_t loads_ = 0;
  std::mutex mutex_;
};
