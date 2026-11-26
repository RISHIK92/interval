#pragma once
#include <algorithm>
#include <cstdint>
#include <list>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// The subject: it updates every subscriber that chose the event, in the order they
// subscribed, and knows nothing else about them.
class BuildEvents {
 public:
  void subscribe(std::string subscriber, std::vector<std::string> events) {
    given(subscriber);
    std::set<std::string> chosen(events.begin(), events.end());
    if (events.empty() || chosen.size() != events.size())
      throw std::invalid_argument("no events, or one listed twice");
    for (const auto& event : events) checkEvent(event);
    if (find(subscriber) != subscribers_.end()) throw std::invalid_argument("already subscribed");
    subscribers_.push_back(Subscriber{subscriber, chosen, {}, std::nullopt});
  }

  bool unsubscribe(std::string subscriber) {
    given(subscriber);
    auto found = find(subscriber);
    if (found == subscribers_.end()) return false;
    subscribers_.erase(found);
    return true;
  }

  std::vector<std::string> publish(std::string event, std::string build) {
    checkEvent(event);
    given(build);
    std::vector<std::string> delivered;
    for (auto& subscriber : subscribers_) {
      if (subscriber.events.count(event) == 0) continue;
      if (subscriber.update(build + " " + event)) delivered.push_back(subscriber.name);
    }
    return delivered;
  }

  std::vector<std::string> inbox(std::string subscriber) { return known(subscriber).inbox; }

  // The extension round: holding deliveries back.
  void pause(std::string subscriber) {
    Subscriber& found = known(subscriber);
    if (found.kept) throw std::invalid_argument("already paused");
    found.kept.emplace();
  }

  int64_t resume(std::string subscriber) {
    Subscriber& found = known(subscriber);
    if (!found.kept) throw std::invalid_argument("not paused");
    found.inbox.insert(found.inbox.end(), found.kept->begin(), found.kept->end());
    int64_t delivered = static_cast<int64_t>(found.kept->size());
    found.kept.reset();
    return delivered;
  }

 private:
  // An observer: it takes delivery of the events it chose. While paused it keeps them
  // back, in order, until it's resumed.
  struct Subscriber {
    std::string name;
    std::set<std::string> events;
    std::vector<std::string> inbox;
    std::optional<std::vector<std::string>> kept;

    // Whether the delivery reached the inbox now (not kept back).
    bool update(const std::string& delivery) {
      if (kept)
        kept->push_back(delivery);
      else
        inbox.push_back(delivery);
      return !kept;
    }
  };

  static void given(const std::string& value) {
    if (value.empty()) throw std::invalid_argument("empty");
  }

  static void checkEvent(const std::string& event) {
    static const std::set<std::string> events = {"queued", "started", "passed", "failed"};
    if (events.count(event) == 0) throw std::invalid_argument("unknown event");
  }

  std::list<Subscriber>::iterator find(const std::string& subscriber) {
    return std::find_if(subscribers_.begin(), subscribers_.end(),
                        [&](const Subscriber& s) { return s.name == subscriber; });
  }

  Subscriber& known(const std::string& subscriber) {
    auto found = find(subscriber);
    if (found == subscribers_.end()) throw std::invalid_argument("not subscribed");
    return *found;
  }

  // In the order of subscription: re-subscribing puts a subscriber at the back.
  std::list<Subscriber> subscribers_;
};
