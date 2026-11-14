#pragma once
#include <cstdint>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>

class UrlShortener {
 public:
  UrlShortener() {}

  std::string shorten(std::string url) {
    checkUrl(url);
    std::lock_guard<std::mutex> hold(mu_);
    auto known = generated_.find(url);
    if (known != generated_.end()) return known->second;
    // A custom alias may already hold the next code: skip it.
    std::string code;
    do {
      code = encode(counter_++);
    } while (urls_.count(code) > 0);
    urls_[code] = url;
    counts_[code] = 0;
    generated_[url] = code;
    return code;
  }

  std::string expand(std::string code) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = urls_.find(code);
    if (it == urls_.end()) throw std::runtime_error("unknown code");
    counts_[code]++;
    return it->second;
  }

  std::string custom(std::string url, std::string alias) {
    checkUrl(url);
    if (alias.empty() || alias.size() > 16) throw std::invalid_argument("invalid alias");
    for (char c : alias)
      if (ALPHABET.find(c) == std::string::npos) throw std::invalid_argument("invalid alias");
    std::lock_guard<std::mutex> hold(mu_);
    if (urls_.count(alias) > 0) throw std::runtime_error("alias taken");
    urls_[alias] = url;
    counts_[alias] = 0;
    return alias;
  }

  int64_t hits(std::string code) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = counts_.find(code);
    if (it == counts_.end()) throw std::runtime_error("unknown code");
    return it->second;
  }

  void expire(std::string code) {
    std::lock_guard<std::mutex> hold(mu_);
    auto it = urls_.find(code);
    if (it == urls_.end()) throw std::runtime_error("unknown code");
    auto g = generated_.find(it->second);
    if (g != generated_.end() && g->second == code) generated_.erase(g);
    urls_.erase(it);
    counts_.erase(code);
  }

 private:
  static inline const std::string ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  static void checkUrl(const std::string& url) {
    size_t rest = 0;
    if (url.rfind("https://", 0) == 0) rest = url.size() - 8;
    else if (url.rfind("http://", 0) == 0) rest = url.size() - 7;
    if (rest == 0 || url.size() > 2048 || url.find(' ') != std::string::npos)
      throw std::invalid_argument("invalid url");
  }

  static std::string encode(int64_t n) {
    std::string out;
    while (n > 0) {
      out.insert(out.begin(), ALPHABET[n % 62]);
      n /= 62;
    }
    return out;
  }

  // Every live code (generated or custom) to its url and hit count.
  std::map<std::string, std::string> urls_;
  std::map<std::string, int64_t> counts_;
  // A url's generated code, so shortening it again gives the same one.
  std::map<std::string, std::string> generated_;
  int64_t counter_ = 1;
  std::mutex mu_;
};
