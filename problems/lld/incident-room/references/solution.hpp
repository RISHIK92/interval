#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

class IncidentRoom {
 public:
  IncidentRoom() {}

  void declareIncident(std::string id, std::string commander, int64_t nowMs) {
    named(id);
    named(commander);
    timed(nowMs);
    if (incidents_.count(id) > 0) throw std::invalid_argument("incident already declared");
    Incident& incident = incidents_[id];
    incident.commander = commander;
    incident.responders.insert(commander);
    incident.declaredAt = nowMs;
    incident.write(nowMs, "declared by " + commander);
  }

  bool joinIncident(std::string id, std::string responder, int64_t nowMs) {
    named(responder);
    Incident& incident = at(id, nowMs);
    if (!incident.responders.insert(responder).second) return false;
    incident.write(nowMs, responder + " joined");
    return true;
  }

  bool note(std::string id, std::string author, std::string text, int64_t nowMs) {
    named(author);
    named(text);
    Incident& incident = at(id, nowMs);
    if (incident.responders.count(author) == 0 || incident.resolvedAt) return false;
    incident.write(nowMs, author + ": " + text);
    return true;
  }

  bool handOff(std::string id, std::string to, int64_t nowMs) {
    named(to);
    Incident& incident = at(id, nowMs);
    if (incident.responders.count(to) == 0 || to == incident.commander) return false;
    incident.write(nowMs, incident.commander + " handed off to " + to);
    incident.commander = to;
    return true;
  }

  std::vector<std::string> timeline(std::string id) { return find(id).lines; }

  // The extension round: resolving closes the incident to notes.
  bool resolve(std::string id, int64_t nowMs) {
    Incident& incident = at(id, nowMs);
    if (incident.resolvedAt) return false;
    incident.resolvedAt = nowMs;
    incident.write(nowMs, "resolved");
    return true;
  }

  int64_t durationMs(std::string id) {
    Incident& incident = find(id);
    if (!incident.resolvedAt) throw std::invalid_argument("not resolved yet");
    return *incident.resolvedAt - incident.declaredAt;
  }

 private:
  static constexpr int64_t kMaxMs = 1000000000000000;

  // Owns its timeline: nothing outside the incident appends to it.
  struct Incident {
    std::string commander;
    std::set<std::string> responders;
    int64_t declaredAt = 0;
    std::optional<int64_t> resolvedAt;
    int64_t lastMs = 0;
    std::vector<std::string> lines;

    void write(int64_t nowMs, const std::string& text) {
      lastMs = nowMs;
      lines.push_back(std::to_string(nowMs) + " " + text);
    }
  };

  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("ids, names and notes are not empty");
  }

  static void timed(int64_t nowMs) {
    if (nowMs < 0 || nowMs > kMaxMs) throw std::invalid_argument("nowMs must be within 0 and 10^15");
  }

  Incident& find(const std::string& id) {
    named(id);
    auto it = incidents_.find(id);
    if (it == incidents_.end()) throw std::invalid_argument("unknown incident");
    return it->second;
  }

  Incident& at(const std::string& id, int64_t nowMs) {
    timed(nowMs);
    Incident& incident = find(id);
    if (nowMs < incident.lastMs) throw std::invalid_argument("time went backwards");
    return incident;
  }

  std::map<std::string, Incident> incidents_;
};
