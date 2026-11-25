#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <regex>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using LogFields = std::map<std::string, std::string>;

// One named way to read a line. Each kind reads it its own way.
class LogFormat {
 public:
  virtual ~LogFormat() = default;
  // The line's fields, or nothing when it's malformed for this kind.
  virtual std::optional<LogFields> fields(const std::string& line) const = 0;
  int64_t count = 0;
};

inline std::vector<std::string> splitOn(const std::string& line, char sep) {
  std::vector<std::string> out{""};
  for (char c : line)
    if (c == sep)
      out.emplace_back();
    else
      out.back() += c;
  return out;
}

class KeyValueFormat : public LogFormat {
 public:
  std::optional<LogFields> fields(const std::string& line) const override {
    LogFields out;
    for (const std::string& token : splitOn(line, ' ')) {
      size_t at = token.find('=');
      if (at == std::string::npos || at == 0) return std::nullopt;
      if (!out.emplace(token.substr(0, at), token.substr(at + 1)).second) return std::nullopt;
    }
    return out;
  }
};

class CsvFormat : public LogFormat {
 public:
  explicit CsvFormat(std::vector<std::string> headers) : headers_(std::move(headers)) {}

  std::optional<LogFields> fields(const std::string& line) const override {
    std::vector<std::string> values = splitOn(line, ',');
    if (values.size() != headers_.size()) return std::nullopt;
    LogFields out;
    for (size_t i = 0; i < values.size(); i++) out[headers_[i]] = values[i];
    return out;
  }

 private:
  std::vector<std::string> headers_;
};

class AccessFormat : public LogFormat {
 public:
  std::optional<LogFields> fields(const std::string& line) const override {
    static const std::regex access(
        R"re(([^ ]+) ([^ ]+) ([^ ]+) \[([^\]]+)\] "([^ "]+) ([^ "]+) ([^ "]+)" ([0-9]{3}) ([0-9]+|-))re");
    static const char* keys[] = {"host", "ident", "user", "time", "method", "path", "protocol", "status", "bytes"};
    std::smatch match;
    if (!std::regex_match(line, match, access)) return std::nullopt;
    LogFields out;
    for (int i = 0; i < 9; i++) out[keys[i]] = match[i + 1].str();
    return out;
  }
};

class LogParser {
 public:
  LogParser() {}

  void addFormat(std::string name, std::string kind, std::vector<std::string> headers) {
    if (name.empty() || index_.count(name)) throw std::invalid_argument("a format needs a new, non-empty name");
    std::unique_ptr<LogFormat> format;
    if (kind == "csv") {
      std::set<std::string> distinct(headers.begin(), headers.end());
      if (headers.empty() || headers.size() > 20 || distinct.count("") || distinct.size() != headers.size())
        throw std::invalid_argument("1-20 distinct, non-empty headers");
      format = std::make_unique<CsvFormat>(headers);
    } else if (kind == "kv" && headers.empty()) {
      format = std::make_unique<KeyValueFormat>();
    } else if (kind == "access" && headers.empty()) {
      format = std::make_unique<AccessFormat>();
    } else {
      throw std::invalid_argument("unknown kind, or headers where none are taken");
    }
    index_[name] = formats_.size();
    formats_.emplace_back(name, std::move(format));
  }

  std::map<std::string, std::string> parse(std::string format, std::string line) {
    LogFormat& chosen = find(format);
    std::optional<LogFields> fields = chosen.fields(line);
    if (!fields) throw std::invalid_argument("malformed line");
    chosen.count++;
    return *fields;
  }

  int64_t parsed(std::string format) { return find(format).count; }

  // The extension round.
  std::optional<std::string> detect(std::string line) {
    for (const auto& [name, candidate] : formats_)
      if (candidate->fields(line)) return name;
    return std::nullopt;
  }

 private:
  LogFormat& find(const std::string& name) {
    auto it = index_.find(name);
    if (it == index_.end()) throw std::out_of_range("no such format");
    return *formats_[it->second].second;
  }

  std::vector<std::pair<std::string, std::unique_ptr<LogFormat>>> formats_;  // in the order added
  std::map<std::string, size_t> index_;
};
