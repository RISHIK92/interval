#pragma once
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <map>
#include <memory>
#include <optional>
#include <regex>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

class RequestBuilder {
 public:
  RequestBuilder(std::string method, std::string url) : method_(method), url_(url) {
    static const std::set<std::string> methods = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"};
    static const std::regex form("https?://[^?# ]+");
    if (methods.count(method) == 0) throw std::invalid_argument("unknown method");
    if (!std::regex_match(url, form)) throw std::invalid_argument("bad url");
  }

  void header(std::string name, std::string value) {
    open();
    std::string key = canonical(name);
    if (key == "Content-Length") throw std::invalid_argument("the length is set automatically");
    auto first = value.find_first_not_of(' ');
    std::string trimmed = first == std::string::npos ? "" : value.substr(first, value.find_last_not_of(' ') - first + 1);
    filled(trimmed);
    headers_[key] = trimmed;
  }

  void query(std::string key, std::string value) {
    open();
    filled(key);
    filled(value);
    pairs_.push_back(encode(key) + "=" + encode(value));
  }

  void body(std::string text) {
    open();
    filled(text);
    text_ = text;
  }

  std::vector<std::string> build() {
    if (!built_) {
      if (text_ && (method_ == "GET" || method_ == "HEAD")) throw std::logic_error("this method takes no body");
      std::map<std::string, std::string> headers = headers_;
      if (text_) headers["Content-Length"] = std::to_string(text_->size());
      std::string target = url_;
      for (size_t i = 0; i < pairs_.size(); i++) target += (i == 0 ? "?" : "&") + pairs_[i];
      std::vector<std::string> lines = {method_ + " " + target};
      for (const auto& [n, v] : headers) lines.push_back(n + ": " + v);
      lines.push_back("");
      lines.push_back(text_.value_or(""));
      built_ = std::make_shared<const std::vector<std::string>>(lines);
    }
    return *built_;
  }

  // The extension round: a shortcut that won't stack a second credential.
  bool bearer(std::string token) {
    open();
    filled(token);
    if (token.find(' ') != std::string::npos) throw std::invalid_argument("a token has no spaces");
    if (headers_.count("Authorization") > 0) return false;
    headers_["Authorization"] = "Bearer " + token;
    return true;
  }

 private:
  static void filled(const std::string& text) {
    if (text.empty()) throw std::invalid_argument("not empty");
  }

  static std::string canonical(const std::string& name) {
    static const std::regex token("[A-Za-z0-9-]+");
    if (!std::regex_match(name, token)) throw std::invalid_argument("a header name is letters, digits and dashes");
    std::string out;
    bool start = true;
    for (char c : name) {
      out += static_cast<char>(start ? std::toupper(static_cast<unsigned char>(c)) : std::tolower(static_cast<unsigned char>(c)));
      start = c == '-';
    }
    return out;
  }

  static std::string encode(const std::string& text) {
    std::string out;
    for (char c : text) {
      if (std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '.' || c == '_' || c == '~') {
        out += c;
      } else {
        char hex[4];
        std::snprintf(hex, sizeof hex, "%%%02X", static_cast<unsigned char>(c));
        out += hex;
      }
    }
    return out;
  }

  void open() const {
    if (built_) throw std::logic_error("the request is built");
  }

  std::string method_;
  std::string url_;
  std::map<std::string, std::string> headers_;
  std::vector<std::string> pairs_;
  std::optional<std::string> text_;
  // What build produced: const, so nothing can change a request once it is built.
  std::shared_ptr<const std::vector<std::string>> built_;
};
