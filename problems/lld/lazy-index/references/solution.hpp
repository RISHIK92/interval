#pragma once
#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// What callers see: the real index and its proxy answer the same calls.
class SearchIndex {
 public:
  virtual ~SearchIndex() = default;
  virtual void addDoc(std::string id, std::string text) = 0;
  virtual std::vector<std::string> search(std::string term) = 0;
  virtual bool removeDoc(std::string id) = 0;
};

// The real subject: each term maps to the documents that contain it. Building it reads
// every document, which is the work the proxy puts off.
class InvertedIndex : public SearchIndex {
 public:
  explicit InvertedIndex(const std::map<std::string, std::string>& docs) {
    for (const auto& [id, text] : docs) addDoc(id, text);
  }

  void addDoc(std::string id, std::string text) override {
    removeDoc(id);
    std::set<std::string> terms;
    std::string word;
    // Runs of ASCII letters and digits, lowercased; the space ends the last one.
    for (char c : text + " ") {
      char lower = (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
      if ((lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9')) {
        word += lower;
      } else if (!word.empty()) {
        terms.insert(word);
        word.clear();
      }
    }
    for (const auto& term : terms) postings_[term].insert(id);
    docs_[id] = terms;
  }

  std::vector<std::string> search(std::string term) override {
    for (char& c : term)
      if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    auto found = postings_.find(term);
    if (found == postings_.end()) return {};
    return std::vector<std::string>(found->second.begin(), found->second.end());
  }

  bool removeDoc(std::string id) override {
    auto found = docs_.find(id);
    if (found == docs_.end()) return false;
    for (const auto& term : found->second) postings_[term].erase(id);
    docs_.erase(found);
    return true;
  }

  int64_t size() const { return static_cast<int64_t>(docs_.size()); }

 private:
  std::map<std::string, std::set<std::string>> postings_;
  std::map<std::string, std::set<std::string>> docs_;
};

// A virtual proxy: it answers like the index, but holds only the raw documents until the
// first search needs the real one. After that, every change goes straight to the real
// index, one document at a time, so it's never built twice.
class LazyIndex : public SearchIndex {
 public:
  void addDoc(std::string id, std::string text) override {
    if (id.empty() || text.empty()) throw std::invalid_argument("empty");
    if (index_) index_->addDoc(id, text);
    else pending_[id] = text;
  }

  std::vector<std::string> search(std::string term) override {
    if (term.empty()) throw std::invalid_argument("a term is letters and digits");
    for (char c : term)
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')))
        throw std::invalid_argument("a term is letters and digits");
    return real().search(term);
  }

  int64_t builds() { return builds_; }

  int64_t indexed() { return index_ ? index_->size() : 0; }

  // The extension round: documents leave without a rebuild either.
  bool removeDoc(std::string id) override {
    if (id.empty()) throw std::invalid_argument("empty");
    if (index_) return index_->removeDoc(id);
    return pending_.erase(id) > 0;
  }

 private:
  InvertedIndex& real() {
    if (!index_) {
      index_ = std::make_unique<InvertedIndex>(pending_);
      builds_ += 1;
    }
    return *index_;
  }

  std::map<std::string, std::string> pending_;
  std::unique_ptr<InvertedIndex> index_;
  int64_t builds_ = 0;
};
