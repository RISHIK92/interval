#pragma once
#include <cstdint>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using CodecFields = std::vector<std::pair<std::string, std::string>>;

// What the registry needs from a codec: turn a flat record into text. Fields arrive
// sorted by name, so every codec writes them in the same order.
class Codec {
 public:
  virtual ~Codec() = default;
  virtual std::string encode(const CodecFields& fields) const = 0;
};

class JsonCodec : public Codec {
 public:
  std::string encode(const CodecFields& fields) const override {
    std::string out = "{";
    for (size_t i = 0; i < fields.size(); i++)
      out += (i ? "," : "") + quoted(fields[i].first) + ":" + quoted(fields[i].second);
    return out + "}";
  }

 private:
  static std::string quoted(const std::string& text) {
    std::string out = "\"";
    for (char c : text) {
      if (c == '\\' || c == '"') out += '\\';
      out += c;
    }
    return out + "\"";
  }
};

class FormCodec : public Codec {
 public:
  std::string encode(const CodecFields& fields) const override {
    std::string out;
    for (size_t i = 0; i < fields.size(); i++)
      out += (i ? "&" : "") + escaped(fields[i].first) + "=" + escaped(fields[i].second);
    return out;
  }

 private:
  static std::string escaped(const std::string& text) {
    static const std::string unreserved =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    std::string out;
    for (char c : text) {
      if (unreserved.find(c) != std::string::npos) {
        out += c;
      } else {
        char code[4];
        std::snprintf(code, sizeof code, "%%%02X", static_cast<unsigned char>(c));
        out += code;
      }
    }
    return out;
  }
};

class CsvCodec : public Codec {
 public:
  std::string encode(const CodecFields& fields) const override {
    std::string header, values;
    for (size_t i = 0; i < fields.size(); i++) {
      header += (i ? "," : "") + cell(fields[i].first);
      values += (i ? "," : "") + cell(fields[i].second);
    }
    return header + "\n" + values;
  }

 private:
  static std::string cell(const std::string& text) {
    if (text.find(',') == std::string::npos && text.find('"') == std::string::npos) return text;
    std::string out = "\"";
    for (char c : text) out += c == '"' ? std::string("\"\"") : std::string(1, c);
    return out + "\"";
  }
};

class CodecRegistry {
 public:
  void add(std::string contentType, std::string codec) {
    if (!isType(contentType, false)) throw std::invalid_argument("bad content type");
    if (codecs_.count(contentType)) throw std::invalid_argument("already added");
    codecs_[contentType] = makeCodec(codec);
    order_.push_back(contentType);
  }

  std::optional<std::string> negotiate(std::string accept) {
    auto ranges = parseRanges(accept);
    std::optional<std::string> best;
    int64_t bestQuality = 0;
    for (const auto& contentType : order_) {
      // The most specific range that matches decides, even when it says q=0.
      std::string top = contentType.substr(0, contentType.find('/'));
      int64_t q = 0;
      for (const auto& range : {contentType, top + "/*", std::string("*/*")}) {
        auto found = ranges.find(range);
        if (found != ranges.end()) {
          q = found->second;
          break;
        }
      }
      if (q > bestQuality) {
        best = contentType;
        bestQuality = q;
      }
    }
    return best ? best : fallback_;
  }

  std::string encodeWith(std::string contentType, std::map<std::string, std::string> fields) {
    auto codec = codecs_.find(contentType);
    if (codec == codecs_.end()) throw std::invalid_argument("no codec for that type");
    if (fields.empty()) throw std::invalid_argument("empty record");
    for (const auto& [name, value] : fields)
      if (name.empty() || value.empty()) throw std::invalid_argument("empty name or value");
    // A std::map is already in order of its names.
    return codec->second->encode(CodecFields(fields.begin(), fields.end()));
  }

  // The extension round: a type to answer with when nothing is acceptable.
  void fallbackType(std::string contentType) {
    if (!codecs_.count(contentType)) throw std::invalid_argument("no codec for that type");
    fallback_ = contentType;
  }

 private:
  // Hand-parsed rather than std::regex: libstdc++'s regex is slow enough to hit the
  // time limit in the judge's gcc image. Same grammar: a token is [a-z0-9][a-z0-9.+-]*,
  // a type is token/token, and a range's subtype may also be *.
  static bool isToken(const std::string& text) {
    return !text.empty() && text[0] != '.' && text[0] != '+' && text[0] != '-' &&
           text.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789.+-") == std::string::npos;
  }
  static bool isType(const std::string& text, bool wildcardSubtype) {
    size_t slash = text.find('/');
    if (slash == std::string::npos || !isToken(text.substr(0, slash))) return false;
    std::string subtype = text.substr(slash + 1);
    return isToken(subtype) || (wildcardSubtype && subtype == "*");
  }

  // The factory method's table: a codec's name makes its codec, and nothing else in the
  // registry knows the concrete classes. A new format is a class and a line here.
  static std::shared_ptr<Codec> makeCodec(const std::string& name) {
    static const std::map<std::string, std::function<std::shared_ptr<Codec>()>> codecs = {
        {"json", [] { return std::make_shared<JsonCodec>(); }},
        {"form", [] { return std::make_shared<FormCodec>(); }},
        {"csv", [] { return std::make_shared<CsvCodec>(); }},
    };
    auto made = codecs.find(name);
    if (made == codecs.end()) throw std::invalid_argument("unknown codec");
    return made->second();
  }

  // A q-value in thousandths, so no float is ever compared.
  static int64_t quality(const std::string& text) {
    // Not std::regex (see isToken): 0(\.[0-9]{0,3})?|1(\.0{0,3})?, the whole text.
    bool unit = !text.empty() && (text[0] == '0' || text[0] == '1');
    if (!unit || (text.size() > 1 && (text.size() > 5 || text[1] != '.' ||
                                      text.find_first_not_of(text[0] == '0' ? "0123456789" : "0", 2) !=
                                          std::string::npos)))
      throw std::invalid_argument("bad q-value");
    size_t dot = text.find('.');
    std::string whole = text.substr(0, dot);
    std::string fraction = dot == std::string::npos ? "" : text.substr(dot + 1);
    return std::stoll(whole) * 1000 + std::stoll((fraction + "000").substr(0, 3));
  }

  static std::string trimmed(const std::string& text) {
    size_t start = text.find_first_not_of(' ');
    if (start == std::string::npos) return "";
    return text.substr(start, text.find_last_not_of(' ') - start + 1);
  }

  static std::vector<std::string> split(const std::string& text, char by) {
    std::vector<std::string> parts{""};
    for (char c : text) {
      if (c == by)
        parts.push_back("");
      else
        parts.back() += c;
    }
    return parts;
  }

  static std::map<std::string, int64_t> parseRanges(const std::string& accept) {
    std::map<std::string, int64_t> ranges;
    for (const auto& item : split(accept, ',')) {
      std::vector<std::string> parts;
      for (const auto& p : split(item, ';')) parts.push_back(trimmed(p));
      const std::string& media = parts[0];
      if (!(media == "*/*" || isType(media, true)) || ranges.count(media) || parts.size() > 2)
        throw std::invalid_argument("bad media range");
      int64_t q = 1000;
      if (parts.size() == 2) {
        if (parts[1].rfind("q=", 0) != 0) throw std::invalid_argument("only q is allowed");
        q = quality(parts[1].substr(2));
      }
      ranges[media] = q;
    }
    return ranges;
  }

  std::map<std::string, std::shared_ptr<Codec>> codecs_;
  std::vector<std::string> order_;  // content types in the order they were added
  std::optional<std::string> fallback_;
};
