#pragma once
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// The process's one ID source. Every caller shares this instance, so the last timestamp
// and its sequence live here and nowhere else: two sources on one node could issue the
// same ID, which is why there is only ever one.
class TraceIds {
 public:
  explicit TraceIds(int64_t nodeId) : node_(nodeId) {
    if (nodeId < 0 || nodeId > kMaxNode) throw std::invalid_argument("node out of range");
  }

  std::string nextId(int64_t nowMs) {
    if (nowMs < 0 || nowMs > kMaxMs) throw std::invalid_argument("time out of range");
    if (nowMs > ms_) {
      ms_ = nowMs;
      sequence_ = 0;
    } else if (sequence_ + 1 < kPerMs) {
      // The same millisecond, or a clock that went backwards: stay on the last one.
      sequence_ += 1;
    } else {
      // A full millisecond borrows the next one, so IDs keep sorting in issue order.
      ms_ += 1;
      sequence_ = 0;
    }
    issued_ += 1;
    char text[32];
    std::snprintf(text, sizeof text, "%013lld-%04lld-%03lld", static_cast<long long>(ms_),
                  static_cast<long long>(node_), static_cast<long long>(sequence_));
    return text;
  }

  int64_t issued() { return issued_; }

  int64_t lastMs() { return ms_; }

  // The extension round: reading an ID back.
  std::vector<int64_t> decode(std::string traceId) {
    const size_t widths[] = {13, 4, 3};  // timestamp, node, sequence
    std::vector<int64_t> values;
    size_t at = 0;
    for (size_t i = 0; i < 3; i++) {
      if (i > 0) {
        if (at >= traceId.size() || traceId[at] != '-') throw std::invalid_argument("not a trace ID");
        at += 1;
      }
      int64_t value = 0;
      for (size_t k = 0; k < widths[i]; k++, at++) {
        if (at >= traceId.size() || traceId[at] < '0' || traceId[at] > '9')
          throw std::invalid_argument("not a trace ID");
        value = value * 10 + (traceId[at] - '0');
      }
      values.push_back(value);
    }
    if (at != traceId.size()) throw std::invalid_argument("not a trace ID");
    if (values[1] > kMaxNode) throw std::invalid_argument("node out of range");
    return values;
  }

 private:
  static constexpr int64_t kMaxNode = 1023;
  static constexpr int64_t kMaxMs = 1000000000000;
  static constexpr int64_t kPerMs = 1000;  // sequences 000 to 999 in one millisecond

  int64_t node_;
  int64_t ms_ = -1;
  int64_t sequence_ = 0;
  int64_t issued_ = 0;
};
