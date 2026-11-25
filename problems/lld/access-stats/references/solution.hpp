#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace access_stats {

const std::set<std::string> kMethods = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"};
constexpr int64_t kMaxLatency = 60000;
constexpr int64_t kMaxTop = 100;

struct Request {
  std::string path;
  int64_t status;
  int64_t latency;
};

inline std::optional<int64_t> digits(const std::string& text, size_t most) {
  if (text.empty() || text.size() > most) return std::nullopt;
  for (char c : text)
    if (c < '0' || c > '9') return std::nullopt;
  return std::stoll(text);
}

inline std::vector<std::string> split(const std::string& line) {
  std::vector<std::string> parts{""};
  for (char c : line) {
    if (c == ' ')
      parts.emplace_back();
    else
      parts.back() += c;
  }
  return parts;
}

// Parsing: one line in, one request or nothing out. It knows the format and nothing else.
inline std::optional<Request> parse(const std::string& line) {
  std::vector<std::string> parts = split(line);
  if (parts.size() != 4 || kMethods.count(parts[0]) == 0 || parts[1].rfind('/', 0) != 0)
    return std::nullopt;
  std::optional<int64_t> status = digits(parts[2], 3);
  std::optional<int64_t> latency = digits(parts[3], 5);
  if (!status || *status < 100 || *status > 599 || !latency || *latency > kMaxLatency)
    return std::nullopt;
  return Request{parts[1].substr(0, parts[1].find('?')), *status, *latency};
}

// Aggregation: running totals of what was parsed. It never sees a raw line or a report.
struct Totals {
  int64_t requests = 0;
  int64_t errors = 0;
  std::map<std::string, std::vector<int64_t>> latencies;
  std::map<std::string, int64_t> classes;

  void add(const Request& request) {
    requests++;
    if (request.status >= 500) errors++;
    latencies[request.path].push_back(request.latency);
    classes[std::to_string(request.status / 100) + "xx"]++;
  }
};

// Reporting: answers computed from the totals, which it only reads.
inline std::vector<std::string> topPaths(const Totals& totals, int64_t n) {
  std::vector<std::string> ranked;
  for (const auto& [path, latencies] : totals.latencies) ranked.push_back(path);
  // std::map already gives byte order, so a stable sort by count keeps it for ties.
  std::stable_sort(ranked.begin(), ranked.end(), [&](const std::string& a, const std::string& b) {
    return totals.latencies.at(a).size() > totals.latencies.at(b).size();
  });
  if (static_cast<int64_t>(ranked.size()) > n) ranked.resize(n);
  return ranked;
}

inline double errorRate(const Totals& totals) {
  return totals.requests > 0 ? static_cast<double>(totals.errors) / totals.requests : 0.0;
}

inline int64_t median(std::vector<int64_t> latencies) {
  std::sort(latencies.begin(), latencies.end());
  return latencies[(latencies.size() - 1) / 2];
}

}  // namespace access_stats

class AccessStats {
 public:
  AccessStats() {}

  bool ingest(std::string line) {
    if (line.empty()) throw std::invalid_argument("an empty line");
    std::optional<access_stats::Request> request = access_stats::parse(line);
    if (!request) return false;
    totals_.add(*request);
    return true;
  }

  std::vector<std::string> topPaths(int64_t n) {
    if (n < 1 || n > access_stats::kMaxTop) throw std::invalid_argument("n is 1 to 100");
    return access_stats::topPaths(totals_, n);
  }

  double errorRate() { return access_stats::errorRate(totals_); }

  int64_t p50(std::string path) {
    auto it = totals_.latencies.find(path);
    if (it == totals_.latencies.end()) throw std::invalid_argument("no requests for that path");
    return access_stats::median(it->second);
  }

  // The extension round.
  std::map<std::string, int64_t> byStatusClass() { return totals_.classes; }

 private:
  access_stats::Totals totals_;
};
