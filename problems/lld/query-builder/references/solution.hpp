#pragma once
#include <cstdint>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// A builder: each call records one part of the query, and build() assembles them in
// SQL's order whatever order they came in. Values are only ever kept as parameters, so
// nothing a caller passes as a value can change the statement.
class QueryBuilder {
 public:
  explicit QueryBuilder(std::string table) : table_(plainName(table)) { joined_.insert(table); }

  void columns(std::vector<std::string> cols) {
    if (cols.empty() || std::set<std::string>(cols.begin(), cols.end()).size() != cols.size())
      throw std::invalid_argument("no columns, or one twice");
    for (const auto& c : cols) plainName(c);
    selected_ = cols;
  }

  void where(std::string column, std::string op, std::string val) {
    static const std::set<std::string> ops = {"=", "<>", "<", "<=", ">", ">=", "LIKE"};
    plainName(column);
    if (!ops.count(op)) throw std::invalid_argument("unknown operator");
    if (val.empty()) throw std::invalid_argument("empty value");
    values_.push_back(val);
    conditions_.push_back(column + " " + op + " $" + std::to_string(values_.size()));
  }

  void orderBy(std::string column, bool desc) {
    if (ordered_.count(plainName(column))) throw std::invalid_argument("already ordered by it");
    ordered_.insert(column);
    order_.push_back(column + (desc ? " DESC" : " ASC"));
  }

  void limit(int64_t n) {
    if (n < 1 || n > kMaxLimit) throw std::invalid_argument("limit out of range");
    rows_ = n;
  }

  std::string build() {
    std::string sql = "SELECT " + (selected_.empty() ? "*" : joined(selected_, ", ")) + " FROM " + table_;
    for (const auto& join : joins_) sql += join;
    if (!conditions_.empty()) sql += " WHERE " + joined(conditions_, " AND ");
    if (!order_.empty()) sql += " ORDER BY " + joined(order_, ", ");
    if (rows_) sql += " LIMIT " + std::to_string(*rows_);
    return sql;
  }

  std::vector<std::string> params() { return values_; }

  // The extension round: joining another table.
  void innerJoin(std::string table, std::string leftColumn, std::string rightColumn) {
    for (const auto& identifier : {table, leftColumn, rightColumn}) plainName(identifier);
    if (joined_.count(table)) throw std::invalid_argument("table already in the query");
    joined_.insert(table);
    joins_.push_back(" INNER JOIN " + table + " ON " + table_ + "." + leftColumn + " = " + table + "." +
                     rightColumn);
  }

 private:
  static constexpr int64_t kMaxLimit = 1000000000;

  // Identifiers go into the text, so only a plain name may: no quotes, spaces or dots.
  static std::string plainName(const std::string& identifier) {
    auto letter = [](char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_'; };
    bool plain = !identifier.empty() && letter(identifier[0]);
    for (char c : identifier) plain = plain && (letter(c) || (c >= '0' && c <= '9'));
    if (!plain) throw std::invalid_argument("not a plain name");
    return identifier;
  }

  static std::string joined(const std::vector<std::string>& parts, const std::string& by) {
    std::string out;
    for (size_t i = 0; i < parts.size(); i++) out += (i ? by : "") + parts[i];
    return out;
  }

  std::string table_;
  std::vector<std::string> selected_;
  std::vector<std::string> conditions_;
  std::vector<std::string> values_;
  std::vector<std::string> order_;
  std::set<std::string> ordered_;
  std::optional<int64_t> rows_;
  std::vector<std::string> joins_;
  std::set<std::string> joined_;
};
