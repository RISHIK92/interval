#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

// The innermost handler: it serves every request it's given.
class Handler {
 public:
  static constexpr int kOk = 200;
  static constexpr int kUnauthorized = 401;

  explicit Handler(std::string name) : name(std::move(name)) {}
  virtual ~Handler() = default;

  virtual int serve(const std::string& path, const std::string& token,
                    std::vector<std::string>& trace) {
    trace.push_back(name + " " + path);
    return kOk;
  }

  const std::string name;
};

// A decorator: it looks like a handler, holds the one it wraps, and adds its own lines
// around the call. Subclasses change only the part they're about. The stack owns every
// handler, so a layer only points at the one it wraps.
class Layer : public Handler {
 public:
  Layer(std::string name, Handler* inner) : Handler(std::move(name)), inner(inner) {}

  int serve(const std::string& path, const std::string& token,
            std::vector<std::string>& trace) override {
    trace.push_back(entered());
    int status = inside(path, token, trace);
    trace.push_back(left(status));
    return status;
  }

  Handler* const inner;

 protected:
  virtual std::string entered() { return "enter " + name; }

  virtual int inside(const std::string& path, const std::string& token,
                     std::vector<std::string>& trace) {
    return inner->serve(path, token, trace);
  }

  virtual std::string left(int) { return "leave " + name; }
};

class Auth : public Layer {
 public:
  using Layer::Layer;

 protected:
  int inside(const std::string& path, const std::string& token,
             std::vector<std::string>& trace) override {
    const std::string bearer = "Bearer ";
    if (token.rfind(bearer, 0) != 0 || token.size() == bearer.size()) {
      trace.push_back("deny");
      return kUnauthorized;
    }
    return Layer::inside(path, token, trace);
  }
};

class RequestId : public Layer {
 public:
  using Layer::Layer;

 protected:
  std::string entered() override {
    seen_ += 1;
    return Layer::entered() + " " + std::to_string(seen_);
  }

 private:
  int64_t seen_ = 0;
};

class Compress : public Layer {
 public:
  using Layer::Layer;

 protected:
  std::string left(int status) override {
    return status == kOk ? Layer::left(status) + " gzip" : Layer::left(status);
  }
};

// A handler wrapped in layers, the last one wrapped outermost.
class HandlerStack {
 public:
  explicit HandlerStack(std::string handler) {
    if (handler.empty()) throw std::invalid_argument("empty handler");
    handler_ = std::make_unique<Handler>(handler);
  }

  void wrap(std::string layer) {
    Handler* inner = top();
    std::unique_ptr<Layer> outer;
    if (layer == "auth")
      outer = std::make_unique<Auth>(layer, inner);
    else if (layer == "request-id")
      outer = std::make_unique<RequestId>(layer, inner);
    else if (layer == "compress")
      outer = std::make_unique<Compress>(layer, inner);
    else
      throw std::invalid_argument("unknown layer");
    wrapped_.push_back(std::move(outer));
  }

  std::vector<std::string> handle(std::string path, std::string token) {
    if (path.empty() || token.empty()) throw std::invalid_argument("empty path or token");
    std::vector<std::string> trace;
    int status = top()->serve(path, token, trace);
    trace.push_back(std::to_string(status));
    return trace;
  }

  std::vector<std::string> layers() {
    std::vector<std::string> names;
    for (auto it = wrapped_.rbegin(); it != wrapped_.rend(); ++it) names.push_back((*it)->name);
    return names;
  }

  // The extension round: peeling the outermost layer off again.
  bool unwrap() {
    if (wrapped_.empty()) return false;
    wrapped_.pop_back();
    return true;
  }

 private:
  Handler* top() {
    if (wrapped_.empty()) return handler_.get();
    return wrapped_.back().get();
  }

  std::unique_ptr<Handler> handler_;
  std::vector<std::unique_ptr<Layer>> wrapped_;
};
