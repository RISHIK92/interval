#pragma once
#include <cstdint>
#include <cstdlib>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

class SprintBoard {
 public:
  explicit SprintBoard(int64_t wipLimit) : limit_(wipLimit) {
    if (wipLimit < 1 || wipLimit > 100) throw std::invalid_argument("wipLimit must be within 1-100");
  }

  std::string add(std::string title, int64_t points) {
    if (title.empty() || points < 1 || points > 100)
      throw std::invalid_argument("a ticket needs a title and 1-100 points");
    tickets_.push_back(Ticket{points, Column::Todo, std::nullopt});
    std::string id = "T-" + std::to_string(tickets_.size());
    index_[id] = tickets_.size() - 1;
    return id;
  }

  bool move(std::string ticket, std::string column) {
    Ticket& t = find(ticket);
    Column to = named(column);
    if (std::abs(static_cast<int>(to) - static_cast<int>(t.column)) != 1 || t.reason) return false;
    if (to == Column::Doing && countIn(Column::Doing) >= limit_) return false;
    t.column = to;
    return true;
  }

  std::string column(std::string ticket) { return kNames[static_cast<int>(find(ticket).column)]; }

  int64_t velocity() {
    int64_t sum = 0;
    for (const Ticket& t : tickets_)
      if (t.column == Column::Done) sum += t.points;
    return sum;
  }

  // The extension round.
  void block(std::string ticket, std::string reason) {
    Ticket& t = find(ticket);
    if (reason.empty()) throw std::invalid_argument("a block needs a reason");
    t.reason = reason;
  }

  void unblock(std::string ticket) { find(ticket).reason.reset(); }

  std::vector<std::string> blocked() {
    std::vector<std::string> out;
    for (size_t i = 0; i < tickets_.size(); i++)
      if (tickets_[i].reason) out.push_back("T-" + std::to_string(i + 1) + ": " + *tickets_[i].reason);
    return out;
  }

 private:
  // The columns, in board order: a ticket moves only to a neighbour.
  enum class Column { Todo, Doing, Review, Done };
  static constexpr const char* kNames[] = {"todo", "doing", "review", "done"};

  struct Ticket {
    int64_t points;
    Column column;
    std::optional<std::string> reason;
  };

  static Column named(const std::string& name) {
    for (int i = 0; i < 4; i++)
      if (name == kNames[i]) return static_cast<Column>(i);
    throw std::invalid_argument("no such column");
  }

  Ticket& find(const std::string& ticket) {
    auto it = index_.find(ticket);
    if (it == index_.end()) throw std::out_of_range("no such ticket");
    return tickets_[it->second];
  }

  int64_t countIn(Column column) const {
    int64_t n = 0;
    for (const Ticket& t : tickets_)
      if (t.column == column) n++;
    return n;
  }

  int64_t limit_;
  std::vector<Ticket> tickets_;  // in ticket-number order
  std::map<std::string, size_t> index_;
};
