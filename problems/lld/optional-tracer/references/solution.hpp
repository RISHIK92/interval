#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Samples one trace in every sampleEvery. The tracer checks arguments the same way for
// every trace, then hands the call to the trace, recording or not.
class Tracer {
 public:
  explicit Tracer(int64_t sampleEvery) : every_(sampleEvery) {
    if (sampleEvery < 1 || sampleEvery > kMaxSampleEvery) throw std::invalid_argument("bad sampling rate");
  }

  std::string startTrace(std::string name) {
    given(name);
    int64_t started = static_cast<int64_t>(traces_.size());
    std::string trace = name + "#" + std::to_string(started + 1);
    if (started % every_ == 0)
      traces_[trace] = std::make_unique<RecordingTrace>();
    else
      traces_[trace] = std::make_unique<NoopTrace>();
    return trace;
  }

  int64_t span(std::string trace, std::string name) {
    Trace& found = find(trace);
    given(name);
    return found.span(name);
  }

  bool endSpan(std::string trace, int64_t spanId) { return find(trace).endSpan(spanId); }

  std::vector<std::string> recorded(std::string trace) { return find(trace).recorded(); }

  // The extension round: sampling a trace that wasn't.
  void forceSample(std::string trace) {
    auto upgraded = find(trace).sampled();
    if (upgraded) traces_[trace] = std::move(upgraded);
  }

 private:
  static constexpr int64_t kMaxSampleEvery = 1000;

  struct Trace {
    virtual ~Trace() = default;
    virtual int64_t span(const std::string& name) = 0;
    virtual bool endSpan(int64_t spanId) = 0;
    virtual std::vector<std::string> recorded() const = 0;
    // The trace that records from now on, or null when this one already does.
    virtual std::unique_ptr<Trace> sampled() const = 0;
  };

  // A sampled trace: spans get ids from 1, and each one is recorded when it ends.
  struct RecordingTrace : Trace {
    std::map<int64_t, std::string> open;
    int64_t started = 0;
    std::vector<std::string> ended;

    int64_t span(const std::string& name) override {
      started += 1;
      open[started] = name;
      return started;
    }

    bool endSpan(int64_t spanId) override {
      auto found = open.find(spanId);
      if (found == open.end()) return false;
      ended.push_back(std::to_string(spanId) + " " + found->second);
      open.erase(found);
      return true;
    }

    std::vector<std::string> recorded() const override { return ended; }
    std::unique_ptr<Trace> sampled() const override { return nullptr; }
  };

  // The null object: the same methods as a recording trace, and they never refuse and
  // record nothing, so callers never check whether a trace is sampled.
  struct NoopTrace : Trace {
    int64_t span(const std::string&) override { return 0; }
    bool endSpan(int64_t) override { return true; }
    std::vector<std::string> recorded() const override { return {}; }
    std::unique_ptr<Trace> sampled() const override { return std::make_unique<RecordingTrace>(); }
  };

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty name");
  }

  Trace& find(const std::string& trace) {
    auto found = traces_.find(trace);
    if (found == traces_.end()) throw std::invalid_argument("unknown trace");
    return *found->second;
  }

  int64_t every_;
  std::map<std::string, std::unique_ptr<Trace>> traces_;
};
