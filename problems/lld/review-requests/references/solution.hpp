#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// Pull requests and people are associated, never owned: a pull request holds the names
// of its author and reviewers, and each reviewer's queue holds pull request ids.
class ReviewQueue {
 public:
  ReviewQueue() {}

  void open(std::string pr, std::string author) {
    named(pr);
    named(author);
    if (prs_.count(pr) > 0) throw std::invalid_argument("pull request already opened");
    prs_[pr].author = author;
  }

  bool request(std::string pr, std::string reviewer) {
    named(pr);
    named(reviewer);
    PullRequest& found = get(pr);
    if (reviewer == found.author || found.requested.count(reviewer) > 0) return false;
    found.requested.insert(reviewer);
    pending_[reviewer].push_back(pr);
    return true;
  }

  bool approve(std::string pr, std::string reviewer) {
    named(pr);
    named(reviewer);
    PullRequest& found = get(pr);
    if (found.requested.count(reviewer) == 0 || found.approved.count(reviewer) > 0) return false;
    found.approved.insert(reviewer);
    auto& queue = pending_[reviewer];
    queue.erase(std::find(queue.begin(), queue.end(), pr));
    return true;
  }

  std::vector<std::string> pendingFor(std::string reviewer) {
    named(reviewer);
    auto it = pending_.find(reviewer);
    return it == pending_.end() ? std::vector<std::string>{} : it->second;
  }

  int64_t approvals(std::string pr) {
    named(pr);
    return static_cast<int64_t>(get(pr).approved.size());
  }

  // The extension round: owners of a path prefix are requested when it's touched.
  void codeowner(std::string pathPrefix, std::string reviewer) {
    named(pathPrefix);
    named(reviewer);
    auto owner = std::make_pair(pathPrefix, reviewer);
    if (std::find(owners_.begin(), owners_.end(), owner) == owners_.end()) owners_.push_back(owner);
  }

  int64_t touch(std::string pr, std::string path) {
    named(pr);
    named(path);
    get(pr);
    int64_t added = 0;
    for (const auto& [prefix, reviewer] : owners_)
      if (path.rfind(prefix, 0) == 0 && request(pr, reviewer)) added++;
    return added;
  }

 private:
  struct PullRequest {
    std::string author;
    std::set<std::string> requested;
    std::set<std::string> approved;
  };

  static void named(const std::string& name) {
    if (name.empty()) throw std::invalid_argument("ids and names are not empty");
  }

  PullRequest& get(const std::string& pr) {
    auto it = prs_.find(pr);
    if (it == prs_.end()) throw std::invalid_argument("unknown pull request");
    return it->second;
  }

  std::map<std::string, PullRequest> prs_;
  std::map<std::string, std::vector<std::string>> pending_;
  std::vector<std::pair<std::string, std::string>> owners_;
};
