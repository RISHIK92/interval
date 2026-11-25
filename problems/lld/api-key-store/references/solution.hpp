#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

class ApiKeyStore {
 public:
  ApiKeyStore() {}

  std::string issue(std::string owner, std::vector<std::string> scopes, int64_t nowMs, int64_t ttlMs) {
    auto grant = grantOf(scopes);
    if (owner.empty() || nowMs < 0 || nowMs > kMaxNow || ttlMs < 1 || ttlMs > kMaxTtl)
      throw std::invalid_argument("an owner, a time and a time to live");
    return add(owner, grant, nowMs, ttlMs);
  }

  bool can(std::string keyId, std::string scope, int64_t nowMs) {
    checked(scope, false);
    auto found = keys_.find(keyId);
    return found != keys_.end() && found->second.live(nowMs) && covers(found->second.grant, scope);
  }

  bool narrow(std::string keyId, std::vector<std::string> scopes) {
    auto grant = grantOf(scopes);
    auto found = keys_.find(keyId);
    if (found == keys_.end() || found->second.revoked) return false;
    for (const auto& s : grant)
      if (!covers(found->second.grant, s)) return false;
    found->second.grant = grant;
    return true;
  }

  bool revoke(std::string keyId) {
    auto found = keys_.find(keyId);
    if (found == keys_.end() || found->second.revoked) return false;
    found->second.revoked = true;
    return true;
  }

  // The extension round.
  std::string rotate(std::string keyId, int64_t nowMs) {
    auto found = keys_.find(keyId);
    if (found == keys_.end() || found->second.rotated || nowMs < 0 || nowMs > kMaxNow ||
        !found->second.live(nowMs))
      throw std::invalid_argument("only a live key is rotated, once");
    Key& key = found->second;
    key.rotated = true;
    key.expires = std::min(key.expires, nowMs + kGraceMs);
    return add(key.owner, key.grant, nowMs, key.ttl);
  }

 private:
  static constexpr int64_t kMaxNow = 10000000000000LL;
  static constexpr int64_t kMaxTtl = 1000000000000LL;
  static constexpr int64_t kGraceMs = 60000;

  struct Key {
    std::string owner;
    std::vector<std::string> grant;
    int64_t ttl;
    int64_t expires;
    bool revoked = false;
    bool rotated = false;
    bool live(int64_t now) const { return !revoked && now < expires; }
  };

  static bool word(const std::string& text) {
    if (text.empty()) return false;
    for (char c : text)
      if (c < 'a' || c > 'z') return false;
    return true;
  }

  static void checked(const std::string& scope, bool wildcard) {
    size_t colon = scope.find(':');
    std::string resource = colon == std::string::npos ? scope : scope.substr(0, colon);
    std::string action = colon == std::string::npos ? "" : scope.substr(colon + 1);
    if (!word(resource) || !(word(action) || (wildcard && action == "*")))
      throw std::invalid_argument("a scope is resource:action");
  }

  static std::vector<std::string> grantOf(const std::vector<std::string>& scopes) {
    if (scopes.size() < 1 || scopes.size() > 20) throw std::invalid_argument("1 to 20 scopes");
    for (const auto& s : scopes) checked(s, true);
    return scopes;
  }

  static bool covers(const std::vector<std::string>& grant, const std::string& scope) {
    std::string wildcard = scope.substr(0, scope.find(':')) + ":*";
    for (const auto& g : grant)
      if (g == scope || g == wildcard) return true;
    return false;
  }

  std::string add(const std::string& owner, const std::vector<std::string>& grant, int64_t now, int64_t ttl) {
    std::string id = "key-" + std::to_string(keys_.size() + 1);
    keys_[id] = Key{owner, grant, ttl, now + ttl};
    return id;
  }

  std::map<std::string, Key> keys_;
};
