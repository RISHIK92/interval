#pragma once
#include <algorithm>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace logquery {

using Row = std::map<std::string, std::string>;

inline const std::string kSource = "logs";
constexpr int kMaxTop = 10000;
constexpr size_t kMaxDigits = 9;

inline bool allDigits(const std::string& text) {
  return !text.empty() && std::all_of(text.begin(), text.end(), [](char c) { return c >= '0' && c <= '9'; });
}

inline const std::string& checkName(const std::string& text) {
  bool ok = !text.empty() && std::all_of(text.begin(), text.end(), [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
  });
  if (!ok) throw std::invalid_argument("a name is letters, digits, _ and .");
  return text;
}

inline std::optional<long long> integer(const std::string& text) {
  std::string digits = text.rfind('-', 0) == 0 ? text.substr(1) : text;
  if (digits.size() <= kMaxDigits && allDigits(digits)) return std::stoll(text);
  return std::nullopt;
}

// One order for every stage: integers by value, before every other value, and other
// values by character code.
inline int compare(const std::string& a, const std::string& b) {
  auto x = integer(a), y = integer(b);
  if (x && y) return (*x > *y) - (*x < *y);
  if (x) return -1;
  if (y) return 1;
  return (a > b) - (a < b);
}

inline bool testOp(const std::string& op, int c) {
  if (op == "=") return c == 0;
  if (op == "!=") return c != 0;
  if (op == "<") return c < 0;
  if (op == "<=") return c <= 0;
  if (op == ">") return c > 0;
  return c >= 0;
}

inline bool isOp(const std::string& op) {
  return op == "=" || op == "!=" || op == "<" || op == "<=" || op == ">" || op == ">=";
}

struct Where;
struct Count;
struct Sort;
struct Top;

struct Visitor {
  virtual ~Visitor() = default;
  virtual std::string where(const Where& s) = 0;
  virtual std::string count(const Count& s) = 0;
  virtual std::string sort(const Sort& s) = 0;
  virtual std::string top(const Top& s) = 0;
};

struct Stage {
  virtual ~Stage() = default;
  virtual std::vector<Row> apply(const std::vector<Row>& rows) const = 0;
  virtual std::string accept(Visitor& visitor) const = 0;
};

struct Where : Stage {
  Where(std::string f, std::string o, std::string v) : field(std::move(f)), op(std::move(o)), value(std::move(v)) {}

  std::vector<Row> apply(const std::vector<Row>& rows) const override {
    std::vector<Row> out;
    for (const Row& r : rows) {
      auto found = r.find(field);
      if (found != r.end() && testOp(op, compare(found->second, value))) out.push_back(r);
    }
    return out;
  }

  std::string accept(Visitor& visitor) const override { return visitor.where(*this); }

  std::string field, op, value;
};

struct Count : Stage {
  explicit Count(std::string f) : field(std::move(f)) {}

  std::vector<Row> apply(const std::vector<Row>& rows) const override {
    std::vector<std::pair<std::string, int>> counts;  // in order of first appearance
    for (const Row& r : rows) {
      auto found = r.find(field);
      if (found == r.end()) continue;
      auto seen = std::find_if(counts.begin(), counts.end(), [&](const auto& c) { return c.first == found->second; });
      if (seen == counts.end()) {
        counts.emplace_back(found->second, 1);
      } else {
        seen->second++;
      }
    }
    std::vector<Row> out;
    for (const auto& [v, n] : counts) out.push_back(Row{{field, v}, {"count", std::to_string(n)}});
    return out;
  }

  std::string accept(Visitor& visitor) const override { return visitor.count(*this); }

  std::string field;
};

struct Sort : Stage {
  Sort(std::string f, bool d) : field(std::move(f)), descending(d) {}

  std::vector<Row> apply(const std::vector<Row>& rows) const override {
    std::vector<Row> having, without;
    for (const Row& r : rows) (r.count(field) ? having : without).push_back(r);
    int order = descending ? -1 : 1;
    // A stable sort: equal rows keep their order.
    std::stable_sort(having.begin(), having.end(), [&](const Row& a, const Row& b) {
      return order * compare(a.at(field), b.at(field)) < 0;
    });
    having.insert(having.end(), without.begin(), without.end());
    return having;
  }

  std::string accept(Visitor& visitor) const override { return visitor.sort(*this); }

  std::string field;
  bool descending;
};

struct Top : Stage {
  explicit Top(int count) : n(count) {}

  std::vector<Row> apply(const std::vector<Row>& rows) const override {
    return std::vector<Row>(rows.begin(), rows.begin() + std::min<size_t>(n, rows.size()));
  }

  std::string accept(Visitor& visitor) const override { return visitor.top(*this); }

  int n;
};

// A visitor: one line per stage, in a canonical spelling.
struct Explainer : Visitor {
  std::string where(const Where& s) override { return "where " + s.field + " " + s.op + " " + s.value; }
  std::string count(const Count& s) override { return "count " + s.field; }
  std::string sort(const Sort& s) override { return "sort " + s.field + (s.descending ? " desc" : " asc"); }
  std::string top(const Top& s) override { return "top " + std::to_string(s.n); }
};

// The parsed query: a source and its stages.
struct Pipeline {
  std::string source;
  std::vector<std::shared_ptr<Stage>> stages;
};

inline std::vector<std::string> split(const std::string& text, char by) {
  std::vector<std::string> out{""};
  for (char c : text) {
    if (c == by) {
      out.emplace_back();
    } else {
      out.back() += c;
    }
  }
  return out;
}

inline std::shared_ptr<Stage> parseStage(const std::vector<std::string>& w) {
  const std::string& kind = w[0];
  size_t n = w.size();
  if (kind == "where" && n == 4 && isOp(w[2])) return std::make_shared<Where>(checkName(w[1]), w[2], w[3]);
  if (kind == "count" && n == 2 && w[1] != "count") return std::make_shared<Count>(checkName(w[1]));
  if (kind == "sort" && n == 2) return std::make_shared<Sort>(checkName(w[1]), false);
  if (kind == "sort" && n == 3 && (w[2] == "asc" || w[2] == "desc"))
    return std::make_shared<Sort>(checkName(w[1]), w[2] == "desc");
  if (kind == "top" && n == 2 && w[1].size() <= 5 && allDigits(w[1])) {
    int top = std::stoi(w[1]);
    if (top >= 1 && top <= kMaxTop) return std::make_shared<Top>(top);
  }
  throw std::invalid_argument("not a stage");
}

inline Pipeline parse(const std::string& query) {
  std::vector<std::vector<std::string>> parts;
  for (const std::string& part : split(query, '|')) {
    std::vector<std::string> words;
    for (const std::string& word : split(part, ' '))
      if (!word.empty()) words.push_back(word);
    if (words.empty()) throw std::invalid_argument("an empty part");
    parts.push_back(words);
  }
  if (parts[0].size() != 1) throw std::invalid_argument("a bad source");
  Pipeline pipeline{parts[0][0], {}};
  for (size_t i = 1; i < parts.size(); i++) pipeline.stages.push_back(parseStage(parts[i]));
  return pipeline;
}

}  // namespace logquery

class LogQuery {
  using Row = logquery::Row;

 public:
  void ingest(std::map<std::string, std::string> fields) {
    if (fields.empty()) throw std::invalid_argument("an empty record");
    for (const auto& [name, value] : fields) {
      logquery::checkName(name);
      if (value.empty()) throw std::invalid_argument("an empty value");
    }
    records_.push_back(fields);
  }

  std::vector<std::string> run(std::string query) {
    std::vector<std::string> out;
    for (const Row& r : rows(checked(query))) {
      std::string line;
      for (const auto& [k, v] : r) line += (line.empty() ? "" : " ") + k + "=" + v;
      out.push_back(line);
    }
    return out;
  }

  std::vector<std::string> explainQuery(std::string query) { return explain(checked(query)); }

  // The extension round: saved views, usable as sources.
  void saveView(std::string name, std::string query) {
    logquery::checkName(name);
    logquery::Pipeline pipeline = checked(query);
    if (name == logquery::kSource || views_.count(name)) throw std::invalid_argument("that source exists");
    views_.emplace(name, pipeline);
  }

 private:
  logquery::Pipeline checked(const std::string& query) {
    logquery::Pipeline pipeline = logquery::parse(query);
    if (pipeline.source != logquery::kSource && !views_.count(pipeline.source))
      throw std::out_of_range("no such source");
    return pipeline;
  }

  std::vector<Row> rows(const logquery::Pipeline& pipeline) {
    auto view = views_.find(pipeline.source);
    std::vector<Row> rows = view == views_.end() ? records_ : this->rows(view->second);
    for (const auto& stage : pipeline.stages) rows = stage->apply(rows);
    return rows;
  }

  std::vector<std::string> explain(const logquery::Pipeline& pipeline) {
    auto view = views_.find(pipeline.source);
    std::vector<std::string> lines =
        view == views_.end() ? std::vector<std::string>{"source " + logquery::kSource} : explain(view->second);
    logquery::Explainer explainer;
    for (const auto& stage : pipeline.stages) lines.push_back(stage->accept(explainer));
    return lines;
  }

  std::vector<Row> records_;
  std::map<std::string, logquery::Pipeline> views_;
};
