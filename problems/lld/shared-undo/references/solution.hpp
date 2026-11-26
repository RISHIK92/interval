#pragma once
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// A command that remembers the key's value before it ran (its memento), so it can be
// undone and redone. `at` counts its key's writes up to the one that last applied it: the
// edit, an undo or a redo.
struct Edit {
  std::string user;
  std::string key;
  std::optional<std::string> before;
  std::string after;
  size_t at = 0;
};

class SharedDoc {
 public:
  void edit(std::string user, std::string key, std::string val) {
    checkUser(user);
    checkName(key);
    checkName(val);
    std::optional<std::string> before;
    auto found = values_.find(key);
    if (found != values_.end()) before = found->second;
    auto command = std::make_shared<Edit>(Edit{user, key, before, val});
    write(*command, "edit", val);
    undos_[user].push_back(command);
    redos_[user].clear();
  }

  bool undo(std::string user) { return undoLast(user, false); }

  bool redo(std::string user) {
    checkUser(user);
    auto& stack = redos_[user];
    if (stack.empty() || conflicts(*stack.back())) return false;
    auto command = stack.back();
    stack.pop_back();
    write(*command, "redo", command->after);
    undos_[user].push_back(command);
    return true;
  }

  std::optional<std::string> value(std::string key) {
    checkName(key);
    auto found = values_.find(key);
    if (found == values_.end()) return std::nullopt;
    return found->second;
  }

  std::vector<std::string> history(std::string key) {
    checkName(key);
    std::vector<std::string> out;
    for (const auto& w : writes_[key]) out.push_back(w.entry);
    return out;
  }

  // The extension round: an undo that goes through despite a conflict.
  bool undoForce(std::string user) { return undoLast(user, true); }

 private:
  struct Write {
    std::string user;
    std::string entry;
  };

  static void checkName(const std::string& text) {
    if (text.empty()) throw std::invalid_argument("an empty name or value");
  }

  static void checkUser(const std::string& user) {
    checkName(user);
    if (user.find(':') != std::string::npos) throw std::invalid_argument("a user name has no colon");
  }

  bool undoLast(const std::string& user, bool force) {
    checkUser(user);
    auto& stack = undos_[user];
    if (stack.empty()) return false;
    std::string action = "undo";
    if (conflicts(*stack.back())) {
      if (!force) return false;
      action = "force";
    }
    auto command = stack.back();
    stack.pop_back();
    write(*command, action, command->before);
    redos_[user].push_back(command);
    return true;
  }

  // Someone else wrote the key after the command last took effect.
  bool conflicts(const Edit& command) {
    const auto& log = writes_[command.key];
    for (size_t i = command.at; i < log.size(); i++)
      if (log[i].user != command.user) return true;
    return false;
  }

  void write(Edit& command, const std::string& action, const std::optional<std::string>& val) {
    if (val) {
      values_[command.key] = *val;
    } else {
      values_.erase(command.key);
    }
    auto& log = writes_[command.key];
    log.push_back(Write{command.user, action + ":" + command.user + ":" + val.value_or("")});
    command.at = log.size();
  }

  std::map<std::string, std::string> values_;
  std::map<std::string, std::vector<Write>> writes_;
  std::map<std::string, std::vector<std::shared_ptr<Edit>>> undos_;
  std::map<std::string, std::vector<std::shared_ptr<Edit>>> redos_;
};
