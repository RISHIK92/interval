#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

namespace job_queue_kinds {

constexpr int64_t kMaxPriority = 1000000;
constexpr int64_t kMaxMs = 1000000000000LL;

struct Job {
  std::string name;
  int64_t priority;
  int64_t notBefore;
  int64_t seq;
};

// The contract every kind honours lives here, once: only ready jobs leave, size counts
// every job, a job leaves once, and peeking asks the same question polling does. A kind
// only says which ready job comes first, so it can't break any of that.
class Queue {
 public:
  virtual ~Queue() = default;

  void push(const Job& job) { jobs_[job.name] = job; }

  std::optional<Job> peek(int64_t now) const {
    std::optional<Job> first;
    for (const auto& [name, job] : jobs_)
      if (job.notBefore <= now && (!first || order(job) < order(*first))) first = job;
    return first;
  }

  std::optional<Job> poll(int64_t now) {
    std::optional<Job> job = peek(now);
    if (job) jobs_.erase(job->name);
    return job;
  }

  bool remove(const std::string& name) { return jobs_.erase(name) > 0; }

  int64_t size() const { return static_cast<int64_t>(jobs_.size()); }

 protected:
  virtual std::pair<int64_t, int64_t> order(const Job& job) const = 0;

 private:
  std::map<std::string, Job> jobs_;
};

class FifoQueue : public Queue {
 protected:
  std::pair<int64_t, int64_t> order(const Job& job) const override { return {job.seq, 0}; }
};

class PriorityQueue : public Queue {
 protected:
  std::pair<int64_t, int64_t> order(const Job& job) const override { return {-job.priority, job.seq}; }
};

class DelayedQueue : public Queue {
 protected:
  std::pair<int64_t, int64_t> order(const Job& job) const override { return {job.notBefore, job.seq}; }
};

inline int64_t time(int64_t ms) {
  if (ms < 0 || ms > kMaxMs) throw std::invalid_argument("a time is 0 to 10^12");
  return ms;
}

}  // namespace job_queue_kinds

class JobQueue {
 public:
  explicit JobQueue(std::string kind) {
    if (kind == "fifo")
      queue_ = std::make_unique<job_queue_kinds::FifoQueue>();
    else if (kind == "priority")
      queue_ = std::make_unique<job_queue_kinds::PriorityQueue>();
    else if (kind == "delayed")
      queue_ = std::make_unique<job_queue_kinds::DelayedQueue>();
    else
      throw std::invalid_argument("an unknown kind");
  }

  void push(std::string job, int64_t priority, int64_t notBeforeMs) {
    if (job.empty() || used_.count(job) > 0) throw std::invalid_argument("a job needs a name of its own");
    if (priority < 0 || priority > job_queue_kinds::kMaxPriority)
      throw std::invalid_argument("a priority is 0 to 10^6");
    int64_t notBefore = job_queue_kinds::time(notBeforeMs);
    queue_->push({job, priority, notBefore, static_cast<int64_t>(used_.size())});
    used_.insert(job);
  }

  std::optional<std::string> poll(int64_t nowMs) {
    std::optional<job_queue_kinds::Job> job = queue_->poll(job_queue_kinds::time(nowMs));
    if (!job) return std::nullopt;
    return job->name;
  }

  std::optional<std::string> peekAt(int64_t nowMs) {
    std::optional<job_queue_kinds::Job> job = queue_->peek(job_queue_kinds::time(nowMs));
    if (!job) return std::nullopt;
    return job->name;
  }

  int64_t size() { return queue_->size(); }

  // The extension round.
  bool cancel(std::string job) {
    if (job.empty()) throw std::invalid_argument("an empty job");
    return queue_->remove(job);
  }

 private:
  std::unique_ptr<job_queue_kinds::Queue> queue_;
  std::set<std::string> used_;
};
