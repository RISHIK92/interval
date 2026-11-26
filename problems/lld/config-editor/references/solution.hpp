#pragma once
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// Every change is a command kept on a history, so undo and redo never need to know
// which kind of edit they're reversing.
class ConfigEditor {
  using Config = std::map<std::string, std::string>;

  struct Command {
    virtual ~Command() = default;
    virtual void apply(Config& config) = 0;
    virtual void undo(Config& config) = 0;
  };

  // A command: one edit to one key. Doing it remembers the key's value before, so
  // undoing it is the same for every kind of edit.
  struct Edit : Command {
    std::string key, val;
    std::optional<std::string> before;

    Edit(std::string k, std::string v) : key(std::move(k)), val(std::move(v)) {}
    virtual bool refused(const Config& config) const = 0;
    virtual void change(Config& config) = 0;

    void apply(Config& config) override {
      auto found = config.find(key);
      before = found == config.end() ? std::nullopt : std::optional<std::string>(found->second);
      change(config);
    }

    void undo(Config& config) override {
      if (before)
        config[key] = *before;
      else
        config.erase(key);
    }
  };

  struct Put : Edit {
    using Edit::Edit;
    bool refused(const Config& config) const override {
      auto found = config.find(key);
      return found != config.end() && found->second == val;
    }
    void change(Config& config) override { config[key] = val; }
  };

  struct Remove : Edit {
    using Edit::Edit;
    bool refused(const Config& config) const override { return config.count(key) == 0; }
    void change(Config& config) override { config.erase(key); }
  };

  struct Append : Edit {
    using Edit::Edit;
    bool refused(const Config& config) const override { return config.count(key) == 0 || val.empty(); }
    void change(Config& config) override { config[key] += val; }
  };

  // Several edits done and undone as one command: undone in reverse order.
  struct Batch : Command {
    std::vector<std::shared_ptr<Edit>> edits;

    explicit Batch(std::vector<std::shared_ptr<Edit>> e) : edits(std::move(e)) {}
    void apply(Config& config) override {
      for (auto& edit : edits) edit->apply(config);
    }
    void undo(Config& config) override {
      for (auto it = edits.rbegin(); it != edits.rend(); ++it) (*it)->undo(config);
    }
  };

  static std::shared_ptr<Edit> makeEdit(const std::string& op, const std::string& key, const std::string& val) {
    if (key.empty()) throw std::invalid_argument("empty key");
    if (op == "put") return std::make_shared<Put>(key, val);
    if (op == "remove") return std::make_shared<Remove>(key, val);
    if (op == "append") return std::make_shared<Append>(key, val);
    throw std::invalid_argument("unknown op");
  }

  void record(std::shared_ptr<Command> command) {
    done_.push_back(std::move(command));
    undone_.clear();
  }

  Config config_;
  std::vector<std::shared_ptr<Command>> done_;
  std::vector<std::shared_ptr<Command>> undone_;

 public:
  bool apply(std::string op, std::string key, std::string val) {
    auto edit = makeEdit(op, key, val);
    if (edit->refused(config_)) return false;
    edit->apply(config_);
    record(edit);
    return true;
  }

  bool undo() {
    if (done_.empty()) return false;
    auto command = done_.back();
    done_.pop_back();
    command->undo(config_);
    undone_.push_back(command);
    return true;
  }

  bool redo() {
    if (undone_.empty()) return false;
    auto command = undone_.back();
    undone_.pop_back();
    command->apply(config_);
    done_.push_back(command);
    return true;
  }

  std::map<std::string, std::string> view() { return config_; }

  // The extension round: several edits as one command.
  bool batch(std::vector<std::string> ops) {
    std::vector<std::shared_ptr<Edit>> edits;
    for (const auto& entry : ops) {
      auto first = entry.find(' ');
      auto second = first == std::string::npos ? std::string::npos : entry.find(' ', first + 1);
      if (second == std::string::npos) throw std::invalid_argument("not <op> <key> <val>");
      edits.push_back(makeEdit(entry.substr(0, first), entry.substr(first + 1, second - first - 1),
                               entry.substr(second + 1)));
    }
    std::vector<std::shared_ptr<Edit>> applied;
    for (auto& edit : edits) {
      if (edit->refused(config_)) continue;
      edit->apply(config_);
      applied.push_back(edit);
    }
    if (applied.empty()) return false;
    record(std::make_shared<Batch>(applied));
    return true;
  }
};
