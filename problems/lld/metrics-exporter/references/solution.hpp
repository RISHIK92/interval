#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using Tags = std::vector<std::pair<std::string, std::string>>;

// A sample is one exported number: its name, the tags it adds to its series' tags, and
// its value. A metric kind decides its samples; a format decides how one is written.
struct Sample {
  std::string name;
  Tags extra;
  int64_t value;
};

class Metric {
 public:
  virtual ~Metric() = default;
  virtual std::string kind() const = 0;
  virtual void add(int64_t value) = 0;
  virtual std::vector<Sample> samples(const std::string& name) const = 0;
};

class CounterMetric : public Metric {
 public:
  std::string kind() const override { return "counter"; }
  void add(int64_t by) override { total_ += by; }
  std::vector<Sample> samples(const std::string& name) const override { return {{name, {}, total_}}; }

 private:
  int64_t total_ = 0;
};

class HistogramMetric : public Metric {
 public:
  static constexpr int64_t kBounds[] = {10, 100, 1000};

  std::string kind() const override { return "histogram"; }
  void add(int64_t val) override {
    for (int i = 0; i < 3; i++)
      if (val <= kBounds[i]) buckets_[i]++;
    count_++;
    sum_ += val;
  }
  std::vector<Sample> samples(const std::string& name) const override {
    std::vector<Sample> out;
    for (int i = 0; i < 3; i++) out.push_back({name + "_bucket", {{"le", std::to_string(kBounds[i])}}, buckets_[i]});
    out.push_back({name + "_bucket", {{"le", "+Inf"}}, count_});
    out.push_back({name + "_sum", {}, sum_});
    out.push_back({name + "_count", {}, count_});
    return out;
  }

 private:
  int64_t buckets_[3] = {0, 0, 0};
  int64_t count_ = 0;
  int64_t sum_ = 0;
};

class GaugeMetric : public Metric {
 public:
  std::string kind() const override { return "gauge"; }
  void add(int64_t val) override { level_ = val; }
  std::vector<Sample> samples(const std::string& name) const override { return {{name, {}, level_}}; }

 private:
  int64_t level_ = 0;
};

// The bridge's other side: how a sample is written, whatever kind it came from.
class Format {
 public:
  virtual ~Format() = default;
  virtual std::vector<std::string> header(const std::string& name, const std::string& kind) const = 0;
  virtual std::string line(const Sample& sample, const Tags& tags, const std::string& kind) const = 0;
};

class PrometheusFormat : public Format {
 public:
  std::vector<std::string> header(const std::string& name, const std::string& kind) const override {
    return {"# TYPE " + name + " " + kind};
  }
  std::string line(const Sample& sample, const Tags& tags, const std::string&) const override {
    if (tags.empty()) return sample.name + " " + std::to_string(sample.value);
    std::string text = sample.name + "{";
    for (size_t i = 0; i < tags.size(); i++) text += (i > 0 ? "," : "") + tags[i].first + "=\"" + tags[i].second + "\"";
    return text + "} " + std::to_string(sample.value);
  }
};

class StatsdFormat : public Format {
 public:
  std::vector<std::string> header(const std::string&, const std::string&) const override { return {}; }
  std::string line(const Sample& sample, const Tags& tags, const std::string& kind) const override {
    std::string text = sample.name + ":" + std::to_string(sample.value) + "|" + (kind == "gauge" ? "g" : "c");
    if (!tags.empty()) {
      text += "|#";
      for (size_t i = 0; i < tags.size(); i++) text += (i > 0 ? "," : "") + tags[i].first + ":" + tags[i].second;
    }
    return text;
  }
};

// The bridge: metric kinds and export formats vary on their own. Each series keeps its
// numbers once; scraping asks the kind for its samples and hands each one to whichever
// format is current.
class MetricsExporter {
 public:
  explicit MetricsExporter(std::string format) : format_(pick(format)) {}

  void counter(std::string name, int64_t by, std::map<std::string, std::string> tags) {
    if (by < 0) throw std::invalid_argument("a counter only goes up");
    seriesFor(name, tags, "counter", [] { return std::make_unique<CounterMetric>(); }).add(by);
  }

  void observe(std::string name, int64_t val, std::map<std::string, std::string> tags) {
    if (tags.count("le") > 0) throw std::invalid_argument("le is the histogram's own tag");
    seriesFor(name, tags, "histogram", [] { return std::make_unique<HistogramMetric>(); }).add(val);
  }

  std::vector<std::string> scrape() {
    std::vector<std::string> out;
    for (const auto& [name, byTags] : series_) {
      for (const auto& line : format_->header(name, kinds_[name])) out.push_back(line);
      for (const auto& [key, found] : byTags) {
        for (const Sample& sample : found.metric->samples(name)) {
          Tags tags = found.tags;
          tags.insert(tags.end(), sample.extra.begin(), sample.extra.end());
          out.push_back(format_->line(sample, tags, found.metric->kind()));
        }
      }
    }
    return out;
  }

  void switchFormat(std::string format) { format_ = pick(format); }

  // The extension round: a third kind. Of the formats, only StatsD's letter changed.
  void gauge(std::string name, int64_t val, std::map<std::string, std::string> tags) {
    seriesFor(name, tags, "gauge", [] { return std::make_unique<GaugeMetric>(); }).add(val);
  }

 private:
  struct Series {
    Tags tags;
    std::unique_ptr<Metric> metric;
  };

  static std::unique_ptr<Format> pick(const std::string& format) {
    if (format == "prometheus") return std::make_unique<PrometheusFormat>();
    if (format == "statsd") return std::make_unique<StatsdFormat>();
    throw std::invalid_argument("unknown format");
  }

  static void word(const std::string& text, const std::string& extra) {
    if (text.empty()) throw std::invalid_argument("empty");
    for (char c : text) {
      bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' ||
                extra.find(c) != std::string::npos;
      if (!ok) throw std::invalid_argument("a character a name, tag key or tag value can't have");
    }
  }

  Metric& seriesFor(const std::string& name, const std::map<std::string, std::string>& tags, const std::string& kind,
                    const std::function<std::unique_ptr<Metric>()>& make) {
    word(name, "");
    for (const auto& [key, value] : tags) {
      word(key, "");
      word(value, "-.");
    }
    auto known = kinds_.find(name);
    if (known != kinds_.end() && known->second != kind) throw std::invalid_argument("another kind's name");
    Tags ordered(tags.begin(), tags.end());
    std::string key;
    for (size_t i = 0; i < ordered.size(); i++) key += (i > 0 ? "," : "") + ordered[i].first + "=" + ordered[i].second;
    auto& byTags = series_[name];
    auto found = byTags.find(key);
    if (found == byTags.end()) found = byTags.emplace(key, Series{ordered, make()}).first;
    kinds_[name] = kind;
    return *found->second.metric;
  }

  std::unique_ptr<Format> format_;
  std::map<std::string, std::string> kinds_;
  // name -> tag text -> series, both in character-code order
  std::map<std::string, std::map<std::string, Series>> series_;
};
