#pragma once
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// One thing a bot can do. A bot is the abilities it holds, never a subclass per mix.
class Ability {
 public:
  virtual ~Ability() = default;
  virtual bool takesArgument() const = 0;
  virtual std::string answer(const std::string& bot, const std::string& argument) const = 0;
};

class Acts : public Ability {
 public:
  explicit Acts(std::string done) : done_(std::move(done)) {}
  bool takesArgument() const override { return true; }
  std::string answer(const std::string&, const std::string& argument) const override {
    return done_ + " " + argument;
  }

 private:
  std::string done_;
};

class Status : public Ability {
 public:
  bool takesArgument() const override { return false; }
  std::string answer(const std::string& bot, const std::string&) const override { return bot + " ok"; }
};

// Wraps any ability and logs each command it answers; the answer is unchanged.
class Audited : public Ability {
 public:
  Audited(std::string verb, std::shared_ptr<const Ability> inner, std::shared_ptr<std::vector<std::string>> log)
      : verb_(std::move(verb)), inner_(std::move(inner)), log_(std::move(log)) {}
  bool takesArgument() const override { return inner_->takesArgument(); }
  std::string answer(const std::string& bot, const std::string& argument) const override {
    std::string reply = inner_->answer(bot, argument);
    std::string command = takesArgument() ? verb_ + " " + argument : verb_;
    log_->push_back(command + " -> " + reply);
    return reply;
  }

 private:
  std::string verb_;
  std::shared_ptr<const Ability> inner_;
  std::shared_ptr<std::vector<std::string>> log_;
};

class BotFleet {
 public:
  BotFleet() {}

  void create(std::string bot, std::vector<std::string> abilities) {
    if (bot.empty() || bots_.count(bot) > 0) throw std::invalid_argument("a bot needs a new, non-empty name");
    for (const auto& name : abilities) ability(name);
    if (std::set<std::string>(abilities.begin(), abilities.end()).size() != abilities.size())
      throw std::invalid_argument("an ability is listed twice");
    Bot made;
    for (const auto& name : abilities) made.equip(name);
    bots_[bot] = made;
  }

  bool grant(std::string bot, std::string name) {
    Bot& found = find(bot);
    ability(name);
    if (found.held.count(name) > 0) return false;
    found.equip(name);
    return true;
  }

  bool revoke(std::string bot, std::string name) {
    Bot& found = find(bot);
    ability(name);
    return found.held.erase(name) > 0;
  }

  std::string handle(std::string bot, std::string command) {
    Bot& found = find(bot);
    auto space = command.find(' ');
    bool spaced = space != std::string::npos;
    std::string verb = spaced ? command.substr(0, space) : command;
    std::string argument = spaced ? command.substr(space + 1) : "";
    auto shape = ability(verb);
    bool fits = shape->takesArgument() ? !argument.empty() : !spaced;
    if (!fits) throw std::invalid_argument("the command doesn't fit its ability");
    auto held = found.held.find(verb);
    if (held == found.held.end()) return "refused";
    return held->second->answer(bot, argument);
  }

  std::vector<std::string> abilities(std::string bot) {
    std::vector<std::string> out;
    for (const auto& [name, _] : find(bot).held) out.push_back(name);
    return out;
  }

  // The extension round: auditing wraps each ability the bot holds, now and later.
  void audit(std::string bot) {
    Bot& found = find(bot);
    if (found.log) return;
    found.log = std::make_shared<std::vector<std::string>>();
    std::vector<std::string> names;
    for (const auto& [name, _] : found.held) names.push_back(name);
    for (const auto& name : names) found.equip(name);
  }

  std::vector<std::string> auditLog(std::string bot) {
    const Bot& found = find(bot);
    return found.log ? *found.log : std::vector<std::string>{};
  }

 private:
  static std::shared_ptr<const Ability> ability(const std::string& name) {
    static const std::map<std::string, std::shared_ptr<const Ability>> known = {
        {"deploy", std::make_shared<Acts>("deployed")},
        {"page", std::make_shared<Acts>("paged")},
        {"query", std::make_shared<Acts>("queried")},
        {"status", std::make_shared<Status>()},
    };
    auto found = known.find(name);
    if (found == known.end()) throw std::invalid_argument("unknown ability");
    return found->second;
  }

  struct Bot {
    std::map<std::string, std::shared_ptr<const Ability>> held;
    std::shared_ptr<std::vector<std::string>> log;

    void equip(const std::string& name) {
      auto base = ability(name);
      if (log)
        held[name] = std::make_shared<Audited>(name, base, log);
      else
        held[name] = base;
    }
  };

  Bot& find(const std::string& bot) {
    auto found = bots_.find(bot);
    if (found == bots_.end()) throw std::invalid_argument("unknown bot");
    return found->second;
  }

  std::map<std::string, Bot> bots_;
};
