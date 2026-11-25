#pragma once
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>

// Every precondition is checked once, at construction: a ServiceSettings that exists is
// valid, and no later call can make it invalid (its class invariant).
class ServiceSettings {
 public:
  ServiceSettings(int64_t port, int64_t workers, int64_t timeoutMs)
      : port_(port), workers_(workers), timeoutMs_(timeoutMs) {
    expect(port >= 1 && port <= 65535, "port is from 1 to 65535");
    expect(validWorkers(workers), "workers is from 1 to 64");
    expect(timeoutMs >= 1 && timeoutMs <= 60000, "timeoutMs is from 1 to 60000");
  }

  bool withWorkers(int64_t n) {
    if (!validWorkers(n)) return false;
    workers_ = n;
    return true;
  }

  int64_t budgetMs(int64_t retries) {
    expect(retries >= 0 && retries <= kMaxRetries, "retries is from 0 to 10");
    return timeoutMs_ * (retries + 1);
  }

  std::string describe() {
    std::string text = "port=" + std::to_string(port_) + " workers=" + std::to_string(workers_) +
                       " timeoutMs=" + std::to_string(timeoutMs_);
    if (tls_) text += " tls=" + tls_->first + "," + tls_->second;
    return text;
  }

  // The extension round: TLS is both paths or neither, never half configured.
  bool withTls(std::string certPath, std::string keyPath) {
    if (certPath.empty() != keyPath.empty()) return false;
    if (certPath.empty())
      tls_.reset();
    else
      tls_ = std::make_pair(certPath, keyPath);
    return true;
  }

 private:
  static constexpr int64_t kMinWorkers = 1, kMaxWorkers = 64;
  static constexpr int64_t kMaxRetries = 10;

  static void expect(bool holds, const char* what) {
    if (!holds) throw std::invalid_argument(what);
  }

  static bool validWorkers(int64_t n) { return n >= kMinWorkers && n <= kMaxWorkers; }

  int64_t port_;
  int64_t workers_;
  int64_t timeoutMs_;
  std::optional<std::pair<std::string, std::string>> tls_;
};
