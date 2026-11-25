#pragma once
#include <cctype>
#include <cstdint>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// The one place the URL rules live. Every entry point asks it, so a new rule is one
// change here and can never apply at one entry point and not another.
class UrlPolicy {
 public:
  void block(const std::string& host) { blocked_.insert(lower(host)); }

  std::vector<std::string> violations(const std::string& url) const {
    if (url.empty()) throw std::invalid_argument("a URL is not empty");
    std::string host = hostOf(url);
    std::vector<std::string> found;
    if (url.size() > kMaxLength) found.push_back("length");
    if (url.rfind("https://", 0) != 0) found.push_back("scheme");
    if (internal(host)) found.push_back("host");
    if (blocked_.count(host) > 0) found.push_back("blocked");
    return found;
  }

 private:
  static constexpr size_t kMaxLength = 200;

  static std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
  }

  // The URL's host in lower case: after the first "://", up to the path, query or
  // fragment, without a port. Empty when there's no "://".
  static std::string hostOf(const std::string& url) {
    size_t at = url.find("://");
    if (at == std::string::npos) return "";
    std::string rest = url.substr(at + 3);
    return lower(rest.substr(0, rest.find_first_of("/?#:")));
  }

  static std::optional<std::vector<int>> ipv4(const std::string& host) {
    std::vector<int> numbers;
    size_t start = 0;
    while (true) {
      size_t dot = host.find('.', start);
      std::string part = host.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
      if (part.empty() || part.size() > 3) return std::nullopt;
      for (char c : part)
        if (c < '0' || c > '9') return std::nullopt;
      numbers.push_back(std::stoi(part));
      if (numbers.back() > 255) return std::nullopt;
      if (dot == std::string::npos) break;
      start = dot + 1;
    }
    if (numbers.size() != 4) return std::nullopt;
    return numbers;
  }

  static bool internal(const std::string& host) {
    if (host.empty() || host == "localhost") return true;
    auto ip = ipv4(host);
    if (!ip) return false;
    int first = (*ip)[0], second = (*ip)[1];
    return first == 10 || first == 127 || (first == 172 && second >= 16 && second <= 31) ||
           (first == 192 && second == 168);
  }

  std::set<std::string> blocked_;
};

class WebhookRules {
 public:
  WebhookRules() {}

  std::vector<std::string> createHook(std::string url) {
    auto found = policy_.violations(url);
    if (found.empty()) hooks_.emplace_back("hook-" + std::to_string(hooks_.size() + 1), url);
    return found;
  }

  std::vector<std::string> updateHook(std::string hookId, std::string url) {
    auto hook = find(hookId);
    auto found = policy_.violations(url);
    if (found.empty()) hook->second = url;
    return found;
  }

  std::vector<std::string> testUrl(std::string url) { return policy_.violations(url); }

  std::vector<std::string> hooks() {
    std::vector<std::string> out;
    for (const auto& [id, url] : hooks_) out.push_back(id + " " + url);
    return out;
  }

  // The extension round: one more rule, in the one place rules live.
  void blockHost(std::string host) {
    if (host.empty()) throw std::invalid_argument("a host is not empty");
    policy_.block(host);
  }

 private:
  std::vector<std::pair<std::string, std::string>>::iterator find(const std::string& id) {
    for (auto it = hooks_.begin(); it != hooks_.end(); ++it)
      if (it->first == id) return it;
    throw std::invalid_argument("no such hook");
  }

  UrlPolicy policy_;
  std::vector<std::pair<std::string, std::string>> hooks_;  // id and URL, in creation order
};
