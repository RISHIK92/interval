#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

constexpr int64_t kEarliest = 0;

struct MergedStream {
  std::vector<std::pair<int64_t, std::string>> lines;
  size_t head = 0;  // the first line not yet returned or passed
};

// An iterator over many time-ordered streams at once. Its position is the (time, stream)
// of the last line it returned or skipped to; each stream keeps its own head, so lines
// added later slot in without rebuilding anything.
class LogMerger {
 public:
  LogMerger() = default;

  bool addLine(std::string stream, int64_t ts, std::string line) {
    if (stream.empty() || line.empty() || ts < kEarliest)
      throw std::invalid_argument("an empty name or line, or a negative time");
    auto found = streams_.find(stream);
    if ((found != streams_.end() && ts < found->second.lines.back().first) ||
        std::make_pair(ts, stream) < at_)
      return false;
    streams_[stream].lines.emplace_back(ts, line);
    return true;
  }

  bool hasNext() { return peek() != nullptr; }

  std::string next() {
    auto* best = peek();
    if (best == nullptr) throw std::out_of_range("no more lines");
    const auto& line = best->second.lines[best->second.head++];
    at_ = {line.first, best->first};
    return std::to_string(line.first) + " " + best->first + " " + line.second;
  }

  int64_t skipUntil(int64_t ts) {
    if (ts < kEarliest) throw std::invalid_argument("a negative time");
    int64_t skipped = 0;
    for (auto& entry : streams_) {
      if (hidden_.count(entry.first) > 0 || !first(entry)) continue;
      const auto& lines = entry.second.lines;
      for (size_t i = entry.second.head; i < lines.size(); i++)
        if (lines[i].first < ts) skipped++;
    }
    // Moving the position is the skip: every line behind it is dropped when reached.
    at_ = std::max(at_, std::make_pair(ts, std::string()));
    return skipped;
  }

  // The extension round: a hidden stream is passed over, not held back.
  void filterStream(std::string stream, bool on) {
    if (stream.empty()) throw std::invalid_argument("an empty stream");
    if (on)
      hidden_.insert(stream);
    else
      hidden_.erase(stream);
  }

 private:
  using Entry = std::pair<const std::string, MergedStream>;

  // Whether the stream has a line at or after the position. Lines behind it (skipped, or
  // passed while the stream was hidden) are dropped for good.
  bool first(Entry& entry) {
    auto& stream = entry.second;
    for (size_t i = stream.head; i < stream.lines.size(); i++) {
      if (std::make_pair(stream.lines[i].first, entry.first) >= at_) {
        stream.head = i;
        return true;
      }
    }
    stream.head = stream.lines.size();
    return false;
  }

  Entry* peek() {
    Entry* best = nullptr;
    for (auto& entry : streams_) {
      if (hidden_.count(entry.first) > 0 || !first(entry)) continue;
      if (best == nullptr ||
          entry.second.lines[entry.second.head].first < best->second.lines[best->second.head].first)
        best = &entry;
    }
    return best;
  }

  std::map<std::string, MergedStream> streams_;
  std::set<std::string> hidden_;
  std::pair<int64_t, std::string> at_{kEarliest, ""};
};
