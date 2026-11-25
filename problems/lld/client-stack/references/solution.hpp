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

constexpr int64_t kFailure = 500;   // a status of at least this is a failure
constexpr int64_t kBackoffMs = 100; // the wait before the first retry; it doubles after
constexpr int64_t kOpenMs = 1000;   // how long a breaker stays open

struct Answer {
  int64_t status;
  int64_t took;
};

// Every layer, and the transport at the bottom, has the same call: a request for a path
// that starts at time t returns its status and how long it took. A layer wraps the one
// below it and never knows what that is.
class Layer {
 public:
  virtual ~Layer() = default;
  virtual Answer call(const std::string& path, int64_t t) = 0;
};

// One path's scripted answers: in order, then the last one again and again.
class Script {
 public:
  explicit Script(std::vector<Answer> answers) : answers_(std::move(answers)) {}
  Answer next() {
    Answer answer = answers_[std::min(served_, answers_.size() - 1)];
    served_++;
    return answer;
  }

 private:
  std::vector<Answer> answers_;
  size_t served_ = 0;
};

class Transport : public Layer {
 public:
  Answer call(const std::string& path, int64_t) override {
    calls++;
    return scripts.at(path).next();
  }

  std::map<std::string, Script> scripts;
  int64_t calls = 0;
};

class Retry : public Layer {
 public:
  Retry(std::unique_ptr<Layer> inner, int64_t retries) : inner_(std::move(inner)), retries_(retries) {}
  Answer call(const std::string& path, int64_t t) override {
    int64_t spent = 0;
    Answer answer{0, 0};
    for (int64_t attempt = 0; attempt <= retries_; attempt++) {
      if (attempt > 0) spent += kBackoffMs << (attempt - 1);
      answer = inner_->call(path, t + spent);
      spent += answer.took;
      if (answer.status < kFailure) break;
    }
    return {answer.status, spent};
  }

 private:
  std::unique_ptr<Layer> inner_;
  int64_t retries_;
};

class Cache : public Layer {
 public:
  Cache(std::unique_ptr<Layer> inner, int64_t ttl) : inner_(std::move(inner)), ttl_(ttl) {}
  Answer call(const std::string& path, int64_t t) override {
    auto at = stored_.find(path);
    if (at != stored_.end() && at->second <= t && t < at->second + ttl_) return {200, 0};
    Answer answer = inner_->call(path, t);
    if (answer.status == 200) stored_[path] = t + answer.took;
    return answer;
  }

 private:
  std::unique_ptr<Layer> inner_;
  int64_t ttl_;
  std::map<std::string, int64_t> stored_;  // path -> when its 200 arrived
};

class Breaker : public Layer {
 public:
  Breaker(std::unique_ptr<Layer> inner, int64_t threshold) : inner_(std::move(inner)), threshold_(threshold) {}
  Answer call(const std::string& path, int64_t t) override {
    if (opened_ && *opened_ <= t && t < *opened_ + kOpenMs) return {503, 0};
    Answer answer = inner_->call(path, t);
    if (answer.status < kFailure) {
      failures_ = 0;
      return answer;
    }
    failures_++;
    if (failures_ >= threshold_) {
      opened_ = t + answer.took;
      // It stays at the threshold, so after the cooldown one more failure reopens it
      // straight away. A success only resets the count; an open window runs out on its own.
      failures_ = threshold_;
    }
    return answer;
  }

 private:
  std::unique_ptr<Layer> inner_;
  int64_t threshold_;
  int64_t failures_ = 0;
  std::optional<int64_t> opened_;
};

class Hedge : public Layer {
 public:
  Hedge(std::unique_ptr<Layer> inner, int64_t after) : inner_(std::move(inner)), after_(after) {}
  Answer call(const std::string& path, int64_t t) override {
    Answer first = inner_->call(path, t);
    if (first.took <= after_) return first;
    Answer second = inner_->call(path, t + after_);
    if (after_ + second.took < first.took) return {second.status, after_ + second.took};
    return first;
  }

 private:
  std::unique_ptr<Layer> inner_;
  int64_t after_;
};

// A decorator stack over a scripted transport: each wrap puts a layer outside the ones
// already there, so the order of the wraps decides what each layer sees.
class ClientStack {
 public:
  ClientStack() {
    auto transport = std::make_unique<Transport>();
    transport_ = transport.get();
    top_ = std::move(transport);
  }

  void script(std::string path, std::vector<int64_t> statuses, std::vector<int64_t> latenciesMs) {
    if (path.empty() || statuses.empty() || statuses.size() != latenciesMs.size())
      throw std::invalid_argument("a path and one latency per status");
    std::vector<Answer> answers;
    for (size_t i = 0; i < statuses.size(); i++) {
      if (statuses[i] < 100 || statuses[i] > 599) throw std::invalid_argument("not an HTTP status");
      if (latenciesMs[i] < 0) throw std::invalid_argument("a negative latency");
      answers.push_back({statuses[i], latenciesMs[i]});
    }
    transport_->scripts.insert_or_assign(path, Script(answers));
  }

  void wrap(std::string layer, int64_t param) {
    if (param < 1 || (layer == "retry" && param > 5)) throw std::invalid_argument("a parameter out of range");
    if (layer == "retry") top_ = std::make_unique<Retry>(std::move(top_), param);
    else if (layer == "cache") top_ = std::make_unique<Cache>(std::move(top_), param);
    else if (layer == "breaker") top_ = std::make_unique<Breaker>(std::move(top_), param);
    else throw std::invalid_argument("unknown layer");
  }

  int64_t fetch(std::string path, int64_t nowMs) {
    if (transport_->scripts.count(path) == 0) throw std::out_of_range("an unscripted path");
    Answer answer = top_->call(path, nowMs);
    elapsed_ = answer.took;
    return answer.status;
  }

  int64_t upstreamCalls() { return transport_->calls; }

  int64_t elapsedMs() { return elapsed_; }

  // The extension round: one more layer, which only needs the same call as the rest.
  void hedge(int64_t afterMs) {
    if (afterMs < 0) throw std::invalid_argument("a negative delay");
    top_ = std::make_unique<Hedge>(std::move(top_), afterMs);
  }

 private:
  std::unique_ptr<Layer> top_;
  Transport* transport_;  // owned by the bottom of top_'s chain
  int64_t elapsed_ = 0;
};
