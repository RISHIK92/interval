"use strict";

const METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const BODILESS = new Set(["GET", "HEAD"]);
const URL_FORM = /^https?:\/\/[^?# ]+$/;
const TOKEN = /^[A-Za-z0-9-]+$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function filled(text) {
  if (text === "") throw new RangeError("not empty");
}

function canonical(name) {
  if (!TOKEN.test(name))
    throw new RangeError("a header name is letters, digits and dashes");
  return name
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

function encode(text) {
  let out = "";
  for (const c of text) {
    out += UNRESERVED.test(c)
      ? c
      : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

class RequestBuilder {
  #method;
  #url;
  #headers = new Map();
  #pairs = [];
  #text = null;
  // What build produced: frozen, so nothing can change a request once it is built.
  #built = null;

  constructor(method, url) {
    if (!METHODS.has(method)) throw new RangeError("unknown method");
    if (!URL_FORM.test(url)) throw new RangeError("bad url");
    this.#method = method;
    this.#url = url;
  }

  #open() {
    if (this.#built !== null) throw new Error("the request is built");
  }

  header(name, value) {
    this.#open();
    const key = canonical(name);
    if (key === "Content-Length")
      throw new RangeError("the length is set automatically");
    const trimmed = value.replace(/^ +| +$/g, "");
    filled(trimmed);
    this.#headers.set(key, trimmed);
  }

  query(key, value) {
    this.#open();
    filled(key);
    filled(value);
    this.#pairs.push(`${encode(key)}=${encode(value)}`);
  }

  body(text) {
    this.#open();
    filled(text);
    this.#text = text;
  }

  build() {
    if (this.#built === null) {
      if (this.#text !== null && BODILESS.has(this.#method))
        throw new RangeError("this method takes no body");
      const headers = new Map(this.#headers);
      if (this.#text !== null)
        headers.set("Content-Length", String(this.#text.length));
      const target =
        this.#url + (this.#pairs.length > 0 ? "?" + this.#pairs.join("&") : "");
      this.#built = Object.freeze([
        `${this.#method} ${target}`,
        ...[...headers.keys()]
          .sort(byCode)
          .map((n) => `${n}: ${headers.get(n)}`),
        "",
        this.#text ?? "",
      ]);
    }
    return [...this.#built];
  }

  // The extension round: a shortcut that won't stack a second credential.
  bearer(token) {
    this.#open();
    filled(token);
    if (token.includes(" ")) throw new RangeError("a token has no spaces");
    if (this.#headers.has("Authorization")) return false;
    this.#headers.set("Authorization", `Bearer ${token}`);
    return true;
  }
}

module.exports = { RequestBuilder };
