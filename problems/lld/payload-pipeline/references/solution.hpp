#pragma once
#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace payload {

inline const std::string kBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
inline const std::string kHex = "0123456789abcdef";

// What any layer can be given to encode: non-empty printable ASCII.
inline bool isPayload(const std::string& text) {
  if (text.empty()) return false;
  for (unsigned char c : text)
    if (c < ' ' || c > '~') return false;
  return true;
}

class Codec {
 public:
  virtual ~Codec() = default;
  virtual std::string encode(const std::string& text) const = 0;
  virtual std::string decode(const std::string& text) const = 0;
};

// The innermost codec: the text as it is.
class Plain : public Codec {
 public:
  std::string encode(const std::string& text) const override { return text; }
  std::string decode(const std::string& text) const override { return text; }
};

// A decorator: it wraps another codec and adds one step on the outside. Decoding accepts
// only what encoding could have produced: whatever unwrap gives back must be a valid
// payload that wraps to exactly the input again.
class Layer : public Codec {
 public:
  explicit Layer(std::shared_ptr<const Codec> inner) : inner_(std::move(inner)) {}

  std::string encode(const std::string& text) const override { return wrap(inner_->encode(text)); }

  std::string decode(const std::string& text) const override {
    std::string raw = unwrap(text);
    if (!isPayload(raw) || wrap(raw) != text) throw std::invalid_argument("not something this layer produced");
    return inner_->decode(raw);
  }

 protected:
  virtual std::string wrap(const std::string& text) const = 0;
  virtual std::string unwrap(const std::string& text) const = 0;

 private:
  std::shared_ptr<const Codec> inner_;
};

class Base64 : public Layer {
 public:
  using Layer::Layer;

 protected:
  std::string wrap(const std::string& text) const override {
    std::string out;
    for (size_t i = 0; i < text.size(); i += 3) {
      size_t have = std::min<size_t>(3, text.size() - i);
      unsigned n = 0;
      for (size_t k = 0; k < 3; k++)
        n = (n << 8) | (k < have ? static_cast<unsigned char>(text[i + k]) : 0u);
      for (size_t k = 0; k < 4; k++) out += k <= have ? kBase64[(n >> (18 - 6 * k)) & 63] : '=';
    }
    return out;
  }

  // Lenient on padding and unused bits: decode() re-encodes, which catches both.
  std::string unwrap(const std::string& text) const override {
    unsigned value = 0;
    int bits = 0;
    std::string out;
    for (char c : text) {
      if (c == '=') break;
      size_t digit = kBase64.find(c);
      if (digit == std::string::npos) throw std::invalid_argument("not base64");
      value = ((value << 6) | static_cast<unsigned>(digit)) & 0xfff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += static_cast<char>((value >> bits) & 0xff);
      }
    }
    return out;
  }
};

class Hex : public Layer {
 public:
  using Layer::Layer;

 protected:
  std::string wrap(const std::string& text) const override {
    std::string out;
    for (unsigned char c : text) {
      out += kHex[c >> 4];
      out += kHex[c & 15];
    }
    return out;
  }

  std::string unwrap(const std::string& text) const override {
    if (text.size() % 2 != 0) throw std::invalid_argument("odd hex");
    std::string out;
    for (size_t i = 0; i < text.size(); i += 2) {
      size_t hi = kHex.find(text[i]);
      size_t lo = kHex.find(text[i + 1]);
      if (hi == std::string::npos || lo == std::string::npos) throw std::invalid_argument("not hex");
      out += static_cast<char>(hi * 16 + lo);
    }
    return out;
  }
};

// A length prefix: "<length>:<text>".
class Frame : public Layer {
 public:
  using Layer::Layer;

 protected:
  std::string wrap(const std::string& text) const override { return std::to_string(text.size()) + ":" + text; }

  std::string unwrap(const std::string& text) const override {
    size_t colon = text.find(':');
    return colon == std::string::npos ? "" : text.substr(colon + 1);
  }
};

// The extension's layer: one check digit, the sum of the character codes mod 10.
class Checksum : public Layer {
 public:
  using Layer::Layer;

 protected:
  std::string wrap(const std::string& text) const override {
    long sum = 0;
    for (unsigned char c : text) sum += c;
    return text + std::to_string(sum % 10);
  }

  std::string unwrap(const std::string& text) const override { return text.substr(0, text.size() - 1); }
};

using Factory = std::function<std::shared_ptr<const Codec>(std::shared_ptr<const Codec>)>;

template <typename T>
Factory factory() {
  return [](std::shared_ptr<const Codec> inner) { return std::make_shared<T>(std::move(inner)); };
}

}  // namespace payload

class PayloadPipeline {
 public:
  void push(std::string layer) {
    static const std::map<std::string, payload::Factory> layers = {{"base64", payload::factory<payload::Base64>()},
                                                                    {"hex", payload::factory<payload::Hex>()},
                                                                    {"frame", payload::factory<payload::Frame>()}};
    auto found = layers.find(layer);
    if (found == layers.end()) throw std::invalid_argument("unknown layer");
    add(layer, found->second);
  }

  std::string encode(std::string text) {
    if (!payload::isPayload(text)) throw std::invalid_argument("not a payload");
    return codec_->encode(text);
  }

  std::string decode(std::string text) {
    if (!payload::isPayload(text)) throw std::invalid_argument("not a payload");
    return codec_->decode(text);
  }

  std::vector<std::string> layers() { return names_; }

  // The extension round: a layer that catches corruption.
  void checksum() { add("checksum", payload::factory<payload::Checksum>()); }

 private:
  static constexpr size_t kMaxLayers = 8;

  void add(const std::string& name, const payload::Factory& layer) {
    if (names_.size() >= kMaxLayers) throw std::invalid_argument("too many layers");
    codec_ = layer(codec_);
    names_.push_back(name);
  }

  std::shared_ptr<const payload::Codec> codec_ = std::make_shared<payload::Plain>();
  std::vector<std::string> names_;
};
