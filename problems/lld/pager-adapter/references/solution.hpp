#pragma once
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// Lets the incident API (team names, sev1 to sev3) drive a legacy pager (numeric team
// codes, levels 1 to 5): pages go out as legacy lines, and the pager's acknowledgements
// come back as the API's words. Numbers are kept as the text the pager sees.
class PagerAdapter {
 public:
  explicit PagerAdapter(std::map<std::string, int64_t> teamCodes) {
    std::set<std::string> taken;
    for (const auto& [team, code] : teamCodes) {
      if (team.empty() || code < 1 || code > kMaxCode) throw std::invalid_argument("bad team or code");
      codes_[team] = std::to_string(code);
      taken.insert(codes_[team]);
    }
    if (taken.size() != codes_.size()) throw std::invalid_argument("two teams share a code");
  }

  std::string page(std::string team, std::string severity, std::string summary) {
    auto code = codes_.find(team);
    auto level = kToLevel.find(severity);
    if (code == codes_.end() || level == kToLevel.end() || summary.empty())
      throw std::invalid_argument("unknown team or severity, or no summary");
    std::string number = std::to_string(sent_.size() + 1);
    sent_[number] = Page{team, code->second, false};
    return "PAGE " + number + " " + code->second + " " + level->second + " " + summary;
  }

  std::optional<std::string> ack(std::string legacyLine) {
    if (legacyLine.empty()) throw std::invalid_argument("empty line");
    std::vector<std::string> fields(1);
    for (char c : legacyLine) {
      if (c == ' ')
        fields.emplace_back();
      else
        fields.back() += c;
    }
    if (fields.size() != 4 || fields[0] != "ACK") return std::nullopt;
    auto page = sent_.find(fields[1]);
    auto severity = kToSeverity.find(fields[3]);
    if (page == sent_.end() || page->second.acked || page->second.code != fields[2] ||
        severity == kToSeverity.end())
      return std::nullopt;
    page->second.acked = true;
    return page->second.team + " acked page " + fields[1] + " at " + severity->second;
  }

  int64_t pages() { return static_cast<int64_t>(sent_.size()); }

 private:
  // The incident API's severities as the legacy pager's levels, and back: five levels
  // fold into three severities.
  inline static const std::map<std::string, std::string> kToLevel = {
      {"sev1", "1"}, {"sev2", "3"}, {"sev3", "5"}};
  inline static const std::map<std::string, std::string> kToSeverity = {
      {"1", "sev1"}, {"2", "sev1"}, {"3", "sev2"}, {"4", "sev3"}, {"5", "sev3"}};
  static constexpr int64_t kMaxCode = 9999;

  struct Page {
    std::string team;
    std::string code;
    bool acked;
  };

  std::map<std::string, std::string> codes_;
  std::map<std::string, Page> sent_;
};
