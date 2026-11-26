#pragma once
#include <algorithm>
#include <cstdint>
#include <initializer_list>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// A consumer group: its members share one position in the topic. It covers the offsets
// from `start`; each one below `next` is in `state` or waiting in `again`.
class Group {
 public:
  Group(std::string t, int64_t from) : topic(std::move(t)), start(from), next(from) {}

  std::vector<int64_t> take(int64_t most, int64_t end) {
    std::vector<int64_t> taken;
    for (int64_t n = std::min<int64_t>(most, again_.size()); n > 0; n--) {
      taken.push_back(*again_.begin());
      again_.erase(again_.begin());
    }
    // Redeliveries are always below `next`, so this keeps offset order.
    int64_t fresh = std::min(most - static_cast<int64_t>(taken.size()), end - next);
    for (int64_t i = 0; i < fresh; i++) taken.push_back(next + i);
    next += fresh;
    for (int64_t offset : taken) state_[offset] = kInFlight;
    return taken;
  }

  bool settle(int64_t offset, bool acked) {
    auto found = state_.find(offset);
    if (found == state_.end() || found->second != kInFlight) return false;
    if (acked) {
      found->second = kDone;
      return true;
    }
    if (++nacks_[offset] == kMaxNacks) {
      found->second = kDead;
      dead.push_back(offset);
    } else {
      toAgain(offset);
    }
    return true;
  }

  int64_t rewind(int64_t offset) {
    int64_t made = 0;
    for (int64_t o = offset; o < next; o++) {
      auto found = state_.find(o);
      bool handed = found != state_.end() && (found->second == kInFlight || found->second == kDone);
      if (o < start || handed) {
        nacks_.erase(o);
        toAgain(o);
        made++;
      }
    }
    start = std::min(start, offset);
    return made;
  }

  const std::string topic;
  std::set<std::string> consumers;
  int64_t start;
  int64_t next;
  std::vector<int64_t> dead;

 private:
  static constexpr int kMaxNacks = 3;
  static constexpr const char* kInFlight = "in-flight";
  static constexpr const char* kDone = "done";
  static constexpr const char* kDead = "dead";

  void toAgain(int64_t offset) {
    state_.erase(offset);
    again_.insert(offset);
  }

  std::set<int64_t> again_;  // offsets to deliver again
  std::map<int64_t, std::string> state_;
  std::map<int64_t, int> nacks_;
};

// The mediator: publishers and consumer groups only ever talk to it, never to each other.
class Broker {
 public:
  int64_t publishMsg(std::string topic, std::string payload) {
    checkNamed({topic, payload});
    auto& messages = topics_[topic];
    messages.push_back(payload);
    return static_cast<int64_t>(messages.size()) - 1;
  }

  void subscribeGroup(std::string group, std::string topic, std::string consumer) {
    checkNamed({group, topic, consumer});
    auto found = groups_.find(group);
    if (found == groups_.end()) {
      found = groups_.emplace(group, Group(topic, size(topic))).first;
    } else if (found->second.topic != topic) {
      throw std::invalid_argument("a group reads one topic");
    }
    found->second.consumers.insert(consumer);
  }

  std::vector<std::string> poll(std::string group, std::string consumer, int64_t max) {
    Group& found = findGroup(group);
    if (!found.consumers.count(consumer) || max < 1 || max > 100)
      throw std::invalid_argument("not a member, or max outside 1 to 100");
    std::vector<std::string> out;
    for (int64_t o : found.take(max, size(found.topic))) out.push_back(shown(found, o));
    return out;
  }

  bool ack(std::string group, int64_t offset) {
    Group& found = findGroup(group);
    checkOffset(offset);
    return found.settle(offset, true);
  }

  bool nack(std::string group, int64_t offset) {
    Group& found = findGroup(group);
    checkOffset(offset);
    return found.settle(offset, false);
  }

  std::vector<std::string> deadLetters(std::string group) {
    Group& found = findGroup(group);
    std::vector<std::string> out;
    for (int64_t o : found.dead) out.push_back(shown(found, o));
    return out;
  }

  // The extension round: rewind a group to an earlier offset.
  int64_t replayFrom(std::string group, int64_t offset) {
    Group& found = findGroup(group);
    checkOffset(offset);
    return found.rewind(offset);
  }

 private:
  static void checkNamed(std::initializer_list<std::string> names) {
    for (const auto& name : names)
      if (name.empty()) throw std::invalid_argument("an empty name or payload");
  }

  static void checkOffset(int64_t offset) {
    if (offset < 0) throw std::invalid_argument("an offset is at least 0");
  }

  int64_t size(const std::string& topic) const {
    auto found = topics_.find(topic);
    return found == topics_.end() ? 0 : static_cast<int64_t>(found->second.size());
  }

  std::string shown(const Group& group, int64_t offset) {
    return std::to_string(offset) + ":" + topics_.at(group.topic).at(offset);
  }

  Group& findGroup(const std::string& group) {
    auto found = groups_.find(group);
    if (found == groups_.end()) throw std::out_of_range("no such group");
    return found->second;
  }

  std::map<std::string, std::vector<std::string>> topics_;
  std::map<std::string, Group> groups_;
};
