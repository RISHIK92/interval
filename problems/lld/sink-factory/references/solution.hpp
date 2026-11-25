#pragma once
#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <vector>

// What every product of the factory can do. Callers hold a sink id and never learn which
// class is behind it.
class Sink {
 public:
  virtual ~Sink() = default;
  virtual std::string kind() const = 0;
  virtual std::string write(const std::string& line) = 0;
};

class StdoutSink : public Sink {
 public:
  std::string kind() const override { return "stdout"; }
  std::string write(const std::string& line) override { return line; }
};

class FileSink : public Sink {
 public:
  explicit FileSink(std::string path) : path_(std::move(path)) {}
  std::string kind() const override { return "file"; }
  std::string write(const std::string& line) override {
    written_ += 1;
    return path_ + ":" + std::to_string(written_) + " " + line;
  }

 private:
  std::string path_;
  int64_t written_ = 0;
};

class SyslogSink : public Sink {
 public:
  SyslogSink(const std::string& host, int port) : address_(host + ":" + std::to_string(port)) {}
  std::string kind() const override { return "syslog"; }
  std::string write(const std::string& line) override { return "<14>" + address_ + " " + line; }

 private:
  std::string address_;
};

class BufferedSink : public Sink {
 public:
  explicit BufferedSink(size_t capacity) : capacity_(capacity) {}
  std::string kind() const override { return "buffered"; }
  std::string write(const std::string& line) override {
    held_.push_back(line);
    if (held_.size() > capacity_) held_.pop_front();
    return "";
  }
  std::vector<std::string> drain() {
    std::vector<std::string> out(held_.begin(), held_.end());
    held_.clear();
    return out;
  }

 private:
  size_t capacity_;
  std::deque<std::string> held_;
};

class SinkFactory {
 public:
  SinkFactory() = default;

  std::string create(std::string spec) { return keep(parse(spec)); }

  std::string kindOf(std::string sink) { return find(sink).kind(); }

  std::string writeLine(std::string sink, std::string line) {
    Sink& found = find(sink);
    filled(line);
    return found.write(line);
  }

  int64_t created(std::string kind) {
    filled(kind);
    auto found = made_.find(kind);
    return found == made_.end() ? 0 : found->second;
  }

  // The extension round: one more product, made by its own method.
  std::string createBuffered(int64_t capacity) {
    if (capacity < 1 || capacity > 1000) throw std::invalid_argument("capacity is 1 to 1000");
    return keep(std::make_unique<BufferedSink>(static_cast<size_t>(capacity)));
  }

  std::vector<std::string> flush(std::string sink) {
    auto* buffered = dynamic_cast<BufferedSink*>(&find(sink));
    if (buffered == nullptr) throw std::invalid_argument("only a buffered sink holds lines");
    return buffered->drain();
  }

 private:
  // The creation step, a parameterised factory (the simple form of factory method): the
  // spec decides which class to make, and only here.
  static std::unique_ptr<Sink> parse(const std::string& spec) {
    static const std::regex file("file:(/[^ ]*)");
    static const std::regex syslog("syslog:([A-Za-z0-9.-]+):([1-9][0-9]{0,4})");
    if (spec == "stdout") return std::make_unique<StdoutSink>();
    std::smatch m;
    if (std::regex_match(spec, m, file) && spec.back() != '/') return std::make_unique<FileSink>(m[1].str());
    if (std::regex_match(spec, m, syslog) && std::stoi(m[2].str()) <= 65535)
      return std::make_unique<SyslogSink>(m[1].str(), std::stoi(m[2].str()));
    throw std::invalid_argument("malformed spec");
  }

  static void filled(const std::string& text) {
    if (text.empty()) throw std::invalid_argument("not empty");
  }

  std::string keep(std::unique_ptr<Sink> sink) {
    int64_t number = ++made_[sink->kind()];
    std::string id = sink->kind() + "-" + std::to_string(number);
    sinks_[id] = std::move(sink);
    return id;
  }

  Sink& find(const std::string& sink) {
    auto found = sinks_.find(sink);
    if (found == sinks_.end()) throw std::out_of_range("unknown sink");
    return *found->second;
  }

  std::map<std::string, std::unique_ptr<Sink>> sinks_;
  std::map<std::string, int64_t> made_;
};
