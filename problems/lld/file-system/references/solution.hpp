#pragma once
#include <algorithm>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

class FileSystem {
 public:
  FileSystem() : root_(new Node{true, "", {}}) {}

  void mkdir(std::string path) {
    std::lock_guard<std::mutex> hold(mu_);
    Node* n = root_.get();
    for (const std::string& p : split(path)) {
      auto it = n->kids.find(p);
      if (it == n->kids.end())
        it = n->kids.emplace(p, std::unique_ptr<Node>(new Node{true, "", {}})).first;
      else if (!it->second->dir)
        throw std::runtime_error("already exists");
      n = it->second.get();
    }
  }

  void write(std::string path, std::string text) {
    std::lock_guard<std::mutex> hold(mu_);
    auto [p, name] = parent(split(path));
    auto it = p->kids.find(name);
    if (it != p->kids.end() && it->second->dir) throw std::runtime_error("is a directory");
    p->kids[name] = std::unique_ptr<Node>(new Node{false, text, {}});
  }

  void appendTo(std::string path, std::string text) {
    std::lock_guard<std::mutex> hold(mu_);
    auto [p, name] = parent(split(path));
    auto it = p->kids.find(name);
    if (it == p->kids.end())
      it = p->kids.emplace(name, std::unique_ptr<Node>(new Node{false, "", {}})).first;
    else if (it->second->dir)
      throw std::runtime_error("is a directory");
    it->second->text += text;
  }

  std::string read(std::string path) {
    std::lock_guard<std::mutex> hold(mu_);
    Node* n = walk(split(path));
    if (n->dir) throw std::runtime_error("is a directory");
    return n->text;
  }

  std::vector<std::string> ls(std::string path) {
    std::lock_guard<std::mutex> hold(mu_);
    std::vector<std::string> parts = split(path);
    Node* n = walk(parts);
    std::vector<std::string> out;
    if (!n->dir) {
      out.push_back(parts.back());
      return out;
    }
    // std::map iterates in byte order, which is the sorted order the problem asks for.
    for (auto& kv : n->kids) out.push_back(kv.first);
    return out;
  }

  void rm(std::string path) {
    std::lock_guard<std::mutex> hold(mu_);
    auto [p, name] = parent(split(path));
    auto it = p->kids.find(name);
    if (it == p->kids.end()) throw std::runtime_error("not found");
    if (it->second->dir && !it->second->kids.empty())
      throw std::runtime_error("directory not empty");
    p->kids.erase(it);
  }

  // The extension round.
  void mv(std::string source, std::string target) {
    std::lock_guard<std::mutex> hold(mu_);
    std::vector<std::string> sp = split(source), tp = split(target);
    if (sp.empty()) throw std::invalid_argument("cannot move the root");
    walk(sp);
    if (tp.size() >= sp.size() && std::equal(sp.begin(), sp.end(), tp.begin()))
      throw std::invalid_argument("cannot move into itself");
    auto [tparent, tname] = parent(tp);
    if (tparent->kids.count(tname)) throw std::runtime_error("already exists");
    auto [sparent, sname] = parent(sp);
    std::unique_ptr<Node> moved = std::move(sparent->kids[sname]);
    sparent->kids.erase(sname);
    tparent->kids[tname] = std::move(moved);
  }

  int64_t size(std::string path) {
    std::lock_guard<std::mutex> hold(mu_);
    return total(walk(split(path)));
  }

 private:
  struct Node {
    bool dir;
    std::string text;
    std::map<std::string, std::unique_ptr<Node>> kids;
  };

  static std::vector<std::string> split(const std::string& path) {
    if (path.empty() || path[0] != '/') throw std::invalid_argument("invalid path");
    std::vector<std::string> out;
    size_t at = 0;
    while (at <= path.size()) {
      size_t end = path.find('/', at);
      if (end == std::string::npos) end = path.size();
      std::string s = path.substr(at, end - at);
      at = end + 1;
      if (s.empty() || s == ".") continue;
      if (s == "..") {
        if (out.empty()) throw std::invalid_argument("invalid path");
        out.pop_back();
      } else {
        out.push_back(s);
      }
    }
    return out;
  }

  Node* walk(const std::vector<std::string>& parts) {
    Node* n = root_.get();
    for (const std::string& p : parts) {
      if (!n->dir) throw std::runtime_error("not a directory");
      auto it = n->kids.find(p);
      if (it == n->kids.end()) throw std::runtime_error("not found");
      n = it->second.get();
    }
    return n;
  }

  std::pair<Node*, std::string> parent(const std::vector<std::string>& parts) {
    if (parts.empty()) throw std::runtime_error("is a directory");
    Node* p = walk(std::vector<std::string>(parts.begin(), parts.end() - 1));
    if (!p->dir) throw std::runtime_error("not a directory");
    return {p, parts.back()};
  }

  static int64_t total(Node* n) {
    if (!n->dir) return (int64_t)n->text.size();
    int64_t sum = 0;
    for (auto& kv : n->kids) sum += total(kv.second.get());
    return sum;
  }

  std::unique_ptr<Node> root_;
  std::mutex mu_;
};
