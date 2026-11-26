#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

constexpr int64_t kMaxReplicas = 1000;

struct Service {
  int64_t replicas = 0;
  bool paused = false;
};

// A command object: it knows how to run itself and how to take itself back. Running
// reports whether anything changed: a command that changed nothing has nothing to undo.
class Command {
 public:
  explicit Command(std::string service) : service(std::move(service)) {}
  virtual ~Command() = default;
  virtual bool run(Service& target) = 0;
  virtual void undo(Service& target) = 0;
  const std::string service;
};

class Scale : public Command {
 public:
  Scale(std::string service, int64_t target) : Command(std::move(service)), target_(target) {}

  bool run(Service& target) override {
    before_ = target.replicas;
    target.replicas = target_;
    return before_ != target_;
  }

  void undo(Service& target) override { target.replicas = before_; }

 private:
  int64_t target_;
  int64_t before_ = 0;
};

class Pause : public Command {
 public:
  using Command::Command;

  bool run(Service& target) override {
    bool changed = !target.paused;
    target.paused = true;
    return changed;
  }

  void undo(Service& target) override { target.paused = false; }
};

class Resume : public Command {
 public:
  using Command::Command;

  bool run(Service& target) override {
    bool changed = target.paused;
    target.paused = false;
    return changed;
  }

  void undo(Service& target) override { target.paused = true; }
};

inline bool isCount(const std::string& text) {
  if (text.empty() || text.size() > 4 || (text.size() > 1 && text[0] == '0')) return false;
  for (char c : text)
    if (c < '0' || c > '9') return false;
  return std::stoll(text) <= kMaxReplicas;
}

inline std::shared_ptr<Command> parseCommand(const std::string& command, const std::string& arg) {
  if (command == "scale") {
    size_t at = arg.find('=');
    std::string name = at == std::string::npos ? "" : arg.substr(0, at);
    std::string count = at == std::string::npos ? "" : arg.substr(at + 1);
    if (name.empty() || !isCount(count)) throw std::invalid_argument("scale takes <service>=<0 to 1000>");
    return std::make_shared<Scale>(name, std::stoll(count));
  }
  if (arg.empty() || arg.find('=') != std::string::npos) throw std::invalid_argument("a service name");
  if (command == "pause") return std::make_shared<Pause>(arg);
  if (command == "resume") return std::make_shared<Resume>(arg);
  throw std::invalid_argument("unknown command");
}

class CommandBus {
 public:
  CommandBus() = default;

  bool submit(std::string id, std::string command, std::string arg) {
    auto entry = accept(id, command, arg, 0);
    if (!entry) return false;
    queue_.push_back(*entry);
    return true;
  }

  std::vector<std::string> execute() {
    std::vector<Entry> ran;
    ran.swap(queue_);
    std::vector<std::string> lines;
    for (const auto& entry : ran) lines.push_back(run(entry));
    return lines;
  }

  std::optional<std::string> undoLast() {
    if (done_.empty()) return std::nullopt;
    Entry entry = done_.back();
    done_.pop_back();
    entry.command->undo(services_[entry.command->service]);
    history_.push_back(entry.id + ": undone");
    return entry.id;
  }

  int64_t replicas(std::string service) {
    if (service.empty()) throw std::invalid_argument("an empty service");
    auto found = services_.find(service);
    return found == services_.end() || found->second.paused ? 0 : found->second.replicas;
  }

  std::vector<std::string> log() { return history_; }

  // The extension round: commands that wait for their time, sharing the ids and the undo
  // stack.
  bool schedule(std::string id, std::string command, std::string arg, int64_t atMs) {
    if (atMs < 0) throw std::invalid_argument("a negative time");
    auto entry = accept(id, command, arg, atMs);
    if (!entry) return false;
    scheduled_.push_back(*entry);
    return true;
  }

  std::vector<std::string> executeDue(int64_t nowMs) {
    if (nowMs < 0) throw std::invalid_argument("a negative time");
    std::vector<Entry> due;
    std::vector<Entry> later;
    for (const auto& entry : scheduled_) (entry.atMs <= nowMs ? due : later).push_back(entry);
    scheduled_.swap(later);
    // A stable sort: commands due at the same time run in the order they were scheduled.
    std::stable_sort(due.begin(), due.end(), [](const Entry& a, const Entry& b) { return a.atMs < b.atMs; });
    std::vector<std::string> lines;
    for (const auto& entry : due) lines.push_back(run(entry));
    return lines;
  }

 private:
  struct Entry {
    std::string id;
    std::string line;
    std::shared_ptr<Command> command;
    int64_t atMs;
  };

  std::optional<Entry> accept(const std::string& id, const std::string& command, const std::string& arg,
                              int64_t atMs) {
    if (id.empty()) throw std::invalid_argument("an empty id");
    auto parsed = parseCommand(command, arg);
    if (!ids_.insert(id).second) return std::nullopt;
    return Entry{id, command + " " + arg, parsed, atMs};
  }

  std::string run(const Entry& entry) {
    std::string line = entry.id + ": skipped";
    if (entry.command->run(services_[entry.command->service])) {
      done_.push_back(entry);
      line = entry.id + ": " + entry.line;
    }
    history_.push_back(line);
    return line;
  }

  std::map<std::string, Service> services_;
  std::set<std::string> ids_;
  std::vector<Entry> queue_;
  std::vector<Entry> scheduled_;
  std::vector<Entry> done_;
  std::vector<std::string> history_;
};
