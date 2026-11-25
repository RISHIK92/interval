"use strict";

// The flyweight factory: hands out the one shared symbol for a text, making it only the
// first time the text is seen. A symbol is the flyweight: one frozen record per distinct
// text, shared by every occurrence.
class Interner {
  #byText = new Map();
  #byId = [];
  #saved = 0;

  intern(text) {
    if (text === "") throw new RangeError("empty text");
    const shared = this.#byText.get(text);
    if (shared !== undefined) {
      this.#saved += text.length;
      return shared.id;
    }
    const symbol = Object.freeze({ id: this.#byId.length, text });
    this.#byText.set(text, symbol);
    this.#byId.push(symbol);
    return symbol.id;
  }

  lookup(id) {
    const symbol = this.#byId[id];
    if (symbol === undefined) throw new RangeError("unknown id");
    return symbol.text;
  }

  size() {
    return this.#byId.length;
  }

  bytesSaved() {
    return this.#saved;
  }
}

module.exports = { Interner };
