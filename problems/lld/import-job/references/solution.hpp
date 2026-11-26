#pragma once
#include <cctype>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

constexpr size_t kFields = 3;
constexpr int64_t kMaxAge = 150;
constexpr int64_t kMaxSeconds = 1000000000;
constexpr int64_t kMsPerSecond = 1000;

// A whole number written without leading zeros, at most `most`; none otherwise.
inline std::optional<int64_t> whole(const std::string& text, int64_t most) {
  if (text.empty() || text.size() > 10 || (text.size() > 1 && text[0] == '0')) return std::nullopt;
  for (char c : text)
    if (c < '0' || c > '9') return std::nullopt;
  int64_t n = std::stoll(text);
  if (n > most) return std::nullopt;
  return n;
}

inline std::string lower(std::string text) {
  for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return text;
}

using Fields = std::vector<std::string>;

// The template method: `run` fixes the skeleton (extract, validate, transform, optionally
// dedupe, load) and each kind fills in only the steps that differ.
class Importer {
 public:
  virtual ~Importer() = default;

  std::map<std::string, int64_t> run(const std::vector<std::string>& lines, bool dedupe) {
    for (const auto& line : lines)
      if (line.empty()) throw std::invalid_argument("an empty line");
    runs_++;
    std::map<std::string, int64_t> counts{
        {"read", static_cast<int64_t>(lines.size())}, {"loaded", 0}, {"rejected", 0}};
    if (dedupe) counts["duplicates"] = 0;
    for (size_t i = 0; i < lines.size(); i++) {
      Fields fields = split(lines[i]);
      std::optional<std::string> reason =
          fields.size() != kFields ? std::optional<std::string>("fields") : validate(fields);
      if (reason) {
        rejects.push_back(std::to_string(runs_) + ":" + std::to_string(i + 1) + " " + *reason);
        counts["rejected"]++;
        continue;
      }
      std::string id = key(fields);
      if (dedupe && keys_.count(id) > 0) {
        counts["duplicates"]++;
        continue;
      }
      keys_.insert(id);
      loaded.push_back(transform(fields));
      counts["loaded"]++;
    }
    return counts;
  }

  std::vector<std::string> loaded;
  std::vector<std::string> rejects;

 protected:
  virtual std::optional<std::string> validate(const Fields& fields) const = 0;
  virtual std::string transform(const Fields& fields) const = 0;
  virtual std::string key(const Fields& fields) const = 0;

 private:
  static Fields split(const std::string& line) {
    Fields parts(1);
    for (char c : line) {
      if (c == ',')
        parts.emplace_back();
      else
        parts.back() += c;
    }
    return parts;
  }

  std::set<std::string> keys_;
  int64_t runs_ = 0;
};

// email,name,age
class UserImporter : public Importer {
 protected:
  std::optional<std::string> validate(const Fields& fields) const override {
    const std::string& email = fields[0];
    size_t at = email.find('@');
    if (at == std::string::npos || at == 0 || at == email.size() - 1 || email.find('@', at + 1) != std::string::npos)
      return "email";
    if (fields[1].empty()) return "name";
    if (!whole(fields[2], kMaxAge)) return "age";
    return std::nullopt;
  }

  std::string transform(const Fields& fields) const override {
    return "user:" + lower(fields[0]) + ":" + fields[1] + ":" + fields[2];
  }

  std::string key(const Fields& fields) const override { return lower(fields[0]); }
};

// ts,type,user, with ts in seconds
class EventImporter : public Importer {
 protected:
  std::optional<std::string> validate(const Fields& fields) const override {
    if (!whole(fields[0], kMaxSeconds)) return "ts";
    if (fields[1] != "click" && fields[1] != "view" && fields[1] != "buy") return "type";
    if (fields[2].empty()) return "user";
    return std::nullopt;
  }

  std::string transform(const Fields& fields) const override {
    return "event:" + std::to_string(std::stoll(fields[0]) * kMsPerSecond) + ":" + fields[1] + ":" + fields[2];
  }

  std::string key(const Fields& fields) const override { return transform(fields); }
};

class ImportJob {
 public:
  explicit ImportJob(std::string kind) {
    if (kind == "users")
      importer_ = std::make_unique<UserImporter>();
    else if (kind == "events")
      importer_ = std::make_unique<EventImporter>();
    else
      throw std::invalid_argument("unknown kind");
  }

  std::map<std::string, int64_t> runImport(std::vector<std::string> lines) { return importer_->run(lines, deduping_); }

  std::vector<std::string> loaded() { return importer_->loaded; }

  std::vector<std::string> rejects() { return importer_->rejects; }

  // The extension round: the skeleton's optional step, switched on or off.
  void dedupe(bool on) { deduping_ = on; }

 private:
  std::unique_ptr<Importer> importer_;
  bool deduping_ = false;
};
