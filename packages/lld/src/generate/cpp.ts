import type { Interface } from "../interface";
import type { TypeAst } from "../types";
import { type Generated, methodsOf } from "./common";

const ct = (t: TypeAst): string => {
  switch (t.kind) {
    case "int":
      return "int64_t";
    case "float":
      return "double";
    case "bool":
      return "bool";
    case "string":
      return "std::string";
    case "list":
      return `std::vector<${ct(t.of)}>`;
    case "map":
      return `std::map<std::string, ${ct(t.of)}>`;
    case "optional":
      return `std::optional<${ct(t.of)}>`;
  }
};

const RUNTIME = String.raw`
// A small JSON reader and writer: C++ has none in its standard library. In a namespace
// of its own, so a player's names (a class Reader, a helper put) never collide.
namespace interval_harness {
struct Json {
  enum Kind { Null, Bool, Num, Str, Arr, Obj } kind = Null;
  bool b = false;
  std::string text;  // a number's own digits, or a string's value
  std::vector<Json> items;
  std::vector<std::pair<std::string, Json>> fields;
};

struct Reader {
  const std::string& s;
  size_t i = 0;
  void ws() { while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) i++; }
  std::string str() {
    std::string out;
    i++;
    while (s[i] != '"') {
      char c = s[i++];
      if (c != '\\') { out += c; continue; }
      char e = s[i++];
      switch (e) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'u': {
          unsigned code = std::stoul(s.substr(i, 4), nullptr, 16);
          i += 4;
          if (code < 0x80) out += static_cast<char>(code);
          else if (code < 0x800) { out += static_cast<char>(0xC0 | (code >> 6)); out += static_cast<char>(0x80 | (code & 0x3F)); }
          else { out += static_cast<char>(0xE0 | (code >> 12)); out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F)); }
          break;
        }
        default: out += e;
      }
    }
    i++;
    return out;
  }
  Json value() {
    ws();
    Json j;
    char c = s[i];
    if (c == '{') {
      j.kind = Json::Obj;
      i++; ws();
      if (s[i] == '}') { i++; return j; }
      while (true) {
        ws(); std::string k = str(); ws(); i++;
        j.fields.emplace_back(k, value());
        ws();
        if (s[i++] == '}') return j;
      }
    }
    if (c == '[') {
      j.kind = Json::Arr;
      i++; ws();
      if (s[i] == ']') { i++; return j; }
      while (true) {
        j.items.push_back(value());
        ws();
        if (s[i++] == ']') return j;
      }
    }
    if (c == '"') { j.kind = Json::Str; j.text = str(); return j; }
    if (s.compare(i, 4, "true") == 0) { i += 4; j.kind = Json::Bool; j.b = true; return j; }
    if (s.compare(i, 5, "false") == 0) { i += 5; j.kind = Json::Bool; return j; }
    if (s.compare(i, 4, "null") == 0) { i += 4; return j; }
    size_t start = i;
    while (i < s.size() && std::string("+-0123456789.eE").find(s[i]) != std::string::npos) i++;
    j.kind = Json::Num;
    j.text = s.substr(start, i - start);
    return j;
  }
};

const Json& field(const Json& j, const std::string& k) {
  for (const auto& f : j.fields) if (f.first == k) return f.second;
  throw std::runtime_error("no field " + k);
}

template <class T> struct From;
template <> struct From<int64_t> { static int64_t get(const Json& j) { return std::stoll(j.text); } };
template <> struct From<double> { static double get(const Json& j) { return std::stod(j.text); } };
template <> struct From<bool> { static bool get(const Json& j) { return j.b; } };
template <> struct From<std::string> { static std::string get(const Json& j) { return j.text; } };
template <class T> struct From<std::vector<T>> {
  static std::vector<T> get(const Json& j) {
    std::vector<T> out;
    for (const auto& x : j.items) out.push_back(From<T>::get(x));
    return out;
  }
};
template <class T> struct From<std::map<std::string, T>> {
  static std::map<std::string, T> get(const Json& j) {
    std::map<std::string, T> out;
    for (const auto& f : j.fields) out[f.first] = From<T>::get(f.second);
    return out;
  }
};
template <class T> struct From<std::optional<T>> {
  static std::optional<T> get(const Json& j) {
    if (j.kind == Json::Null) return std::nullopt;
    return From<T>::get(j);
  }
};

// Declared first: a template's call to another overload is looked up where the
// template is defined, and these live in the global namespace (no ADL from std).
template <class T> void put(std::string& o, const std::optional<T>& v);
template <class T> void put(std::string& o, const std::vector<T>& v);
template <class T> void put(std::string& o, const std::map<std::string, T>& v);

void put(std::string& o, int64_t v) { o += std::to_string(v); }
void put(std::string& o, double v) {
  if (!std::isfinite(v)) throw std::domain_error("not a finite number");
  char b[32];
  std::snprintf(b, sizeof b, "%.17g", v);
  o += b;
}
void put(std::string& o, bool v) { o += v ? "true" : "false"; }
void put(std::string& o, const std::string& v) {
  o += '"';
  for (unsigned char c : v) {
    if (c == '"' || c == '\\') { o += '\\'; o += static_cast<char>(c); }
    else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += static_cast<char>(c);
  }
  o += '"';
}
template <class T> void put(std::string& o, const std::optional<T>& v) {
  if (v) put(o, *v); else o += "null";
}
template <class T> void put(std::string& o, const std::vector<T>& v) {
  o += '[';
  for (size_t k = 0; k < v.size(); k++) { if (k) o += ','; put(o, static_cast<T>(v[k])); }
  o += ']';
}
template <class T> void put(std::string& o, const std::map<std::string, T>& v) {
  o += '{';
  bool first = true;
  for (const auto& e : v) { if (!first) o += ','; first = false; put(o, e.first); o += ':'; put(o, e.second); }
  o += '}';
}

std::string clean(const std::string& s) {
  std::string out;
  for (unsigned char c : s) out += (c >= ' ' && c <= '~') ? static_cast<char>(c) : '?';
  return out.substr(0, 200);
}
}  // namespace interval_harness
`;

export function cpp(iface: Interface): Generated {
  const { ctor, methods } = methodsOf(iface);
  const sig = (ps: typeof ctor) =>
    ps.map((p) => `${ct(p.type)} ${p.name}`).join(", ");
  const starter = [
    "#pragma once",
    "#include <cstdint>",
    "#include <map>",
    "#include <optional>",
    "#include <stdexcept>",
    "#include <string>",
    "#include <vector>",
    "",
    `class ${iface.class} {`,
    " public:",
    `  ${iface.class}(${sig(ctor)}) {}`,
    ...methods.flatMap((m) => [
      "",
      `  ${m.returns === "void" ? "void" : ct(m.returns)} ${m.name}(${sig(m.params)}) {`,
      '    throw std::logic_error("not implemented");',
      "  }",
    ]),
    "};",
    "",
  ].join("\n");
  const args = (ps: typeof ctor) =>
    ps
      .map((p, i) => `h::From<${ct(p.type)}>::get(a.items.at(${String(i)}))`)
      .join(", ");
  const arms = [
    `      if (m == "new") { obj.emplace(${args(ctor)}); line += "null"; }`,
    ...methods.map((x) =>
      x.returns === "void"
        ? `      else if (m == "${x.name}") { obj.value().${x.name}(${args(x.params)}); line += "null"; }`
        : // Cast to the declared type, so a player's own int or long still writes.
          `      else if (m == "${x.name}") { h::put(line, static_cast<${ct(x.returns)}>(obj.value().${x.name}(${args(x.params)}))); }`,
    ),
    '      else throw std::invalid_argument("unknown method " + m);',
  ];
  const harness = [
    "// Generated by @interval/lld (P5-W29-S02); do not edit.",
    "#include <cctype>",
    "#include <cmath>",
    "#include <cstdint>",
    "#include <cstdio>",
    "#include <iostream>",
    "#include <iterator>",
    "#include <map>",
    "#include <optional>",
    "#include <sstream>",
    "#include <stdexcept>",
    "#include <string>",
    "#include <unistd.h>",
    "#include <vector>",
    "",
    '#include "solution.hpp"',
    RUNTIME,
    "namespace h = interval_harness;",
    "",
    "int main() {",
    "  // The submission's own prints (stdio or iostream) go to stderr: fd 1 becomes fd 2,",
    "  // and the results are written to the original stdout's copy.",
    "  std::fflush(stdout);",
    "  int real = dup(1);",
    "  dup2(2, 1);",
    "  std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());",
    "  h::Reader reader{input};",
    "  h::Json scenario = reader.value();",
    '  const h::Json& calls = h::field(scenario, "calls");',
    `  std::optional<${iface.class}> obj;`,
    "  std::string out;",
    "  for (size_t i = 0; i < calls.items.size(); i++) {",
    "    const h::Json& c = calls.items[i];",
    '    std::string m = h::field(c, "method").text;',
    '    const h::Json& a = h::field(c, "args");',
    '    std::string line = "{\\"call\\":" + std::to_string(i) + ",\\"value\\":";',
    "    try {",
    ...arms,
    "      line += '}';",
    "    } catch (const std::exception& e) {",
    '      line = "{\\"call\\":" + std::to_string(i) + ",\\"error\\":";',
    '      h::put(line, h::clean(std::string("exception: ") + e.what()));',
    "      line += '}';",
    "    } catch (...) {",
    "      // A throw of anything else (an int, a string): an error line, never a crash.",
    '      line = "{\\"call\\":" + std::to_string(i) + ",\\"error\\":\\"exception: unknown\\"}";',
    "    }",
    "    out += line + '\\n';",
    "  }",
    "  size_t done = 0;",
    "  while (done < out.size()) {",
    "    ssize_t n = write(real, out.data() + done, out.size() - done);",
    "    if (n <= 0) _exit(1);",
    "    done += static_cast<size_t>(n);",
    "  }",
    "  // The submission's buffered prints go out (to stderr) first; then exit at once, so",
    "  // its leftover threads can't keep the run alive or end it badly.",
    "  std::fflush(nullptr);",
    "  std::cout.flush();",
    "  _exit(0);",
    "}",
    "",
  ].join("\n");
  return {
    solutionFile: "solution.hpp",
    starter,
    harnessFile: "main.cpp",
    harness,
  };
}
