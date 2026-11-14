"use strict";

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

class UrlShortener {
  constructor() {
    // Every live code (generated or custom) to its url and hit count.
    this.urls = new Map();
    this.counts = new Map();
    // A url's generated code, so shortening it again gives the same one.
    this.generated = new Map();
    this.counter = 1;
  }

  static checkUrl(url) {
    const rest = url.startsWith("https://")
      ? url.slice(8)
      : url.startsWith("http://")
        ? url.slice(7)
        : "";
    if (rest === "" || url.length > 2048 || url.includes(" "))
      throw new RangeError("invalid url");
  }

  static encode(n) {
    let out = "";
    while (n > 0) {
      out = ALPHABET[n % 62] + out;
      n = Math.floor(n / 62);
    }
    return out;
  }

  shorten(url) {
    UrlShortener.checkUrl(url);
    const known = this.generated.get(url);
    if (known !== undefined) return known;
    // A custom alias may already hold the next code: skip it.
    let code;
    do {
      code = UrlShortener.encode(this.counter++);
    } while (this.urls.has(code));
    this.urls.set(code, url);
    this.counts.set(code, 0);
    this.generated.set(url, code);
    return code;
  }

  expand(code) {
    const url = this.urls.get(code);
    if (url === undefined) throw new RangeError("unknown code");
    this.counts.set(code, this.counts.get(code) + 1);
    return url;
  }

  custom(url, alias) {
    UrlShortener.checkUrl(url);
    if (!/^[0-9a-zA-Z]{1,16}$/.test(alias))
      throw new RangeError("invalid alias");
    if (this.urls.has(alias)) throw new RangeError("alias taken");
    this.urls.set(alias, url);
    this.counts.set(alias, 0);
    return alias;
  }

  hits(code) {
    const n = this.counts.get(code);
    if (n === undefined) throw new RangeError("unknown code");
    return n;
  }

  expire(code) {
    const url = this.urls.get(code);
    if (url === undefined) throw new RangeError("unknown code");
    this.urls.delete(code);
    this.counts.delete(code);
    if (this.generated.get(url) === code) this.generated.delete(url);
  }
}

module.exports = { UrlShortener };
