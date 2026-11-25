"use strict";

const OK = 200;
const UNAUTHORIZED = 401;
const BEARER = "Bearer ";

// The innermost handler: it serves every request it's given.
class Handler {
  constructor(name) {
    this.name = name;
  }

  serve(path, token, trace) {
    trace.push(`${this.name} ${path}`);
    return OK;
  }
}

// A decorator: it looks like a handler, holds the one it wraps, and adds its own lines
// around the call. Subclasses change only the part they're about.
class Layer extends Handler {
  constructor(name, inner) {
    super(name);
    this.inner = inner;
  }

  serve(path, token, trace) {
    trace.push(this.entered());
    const status = this.inside(path, token, trace);
    trace.push(this.left(status));
    return status;
  }

  entered() {
    return `enter ${this.name}`;
  }

  inside(path, token, trace) {
    return this.inner.serve(path, token, trace);
  }

  left(_status) {
    return `leave ${this.name}`;
  }
}

class Auth extends Layer {
  inside(path, token, trace) {
    if (!token.startsWith(BEARER) || token.length === BEARER.length) {
      trace.push("deny");
      return UNAUTHORIZED;
    }
    return super.inside(path, token, trace);
  }
}

class RequestId extends Layer {
  #seen = 0;

  entered() {
    this.#seen += 1;
    return `${super.entered()} ${this.#seen}`;
  }
}

class Compress extends Layer {
  left(status) {
    return status === OK ? `${super.left(status)} gzip` : super.left(status);
  }
}

const KINDS = new Map([
  ["auth", Auth],
  ["request-id", RequestId],
  ["compress", Compress],
]);

// A handler wrapped in layers, the last one wrapped outermost.
class HandlerStack {
  #top;
  #wrapped = [];

  constructor(handler) {
    if (handler === "") throw new RangeError("empty handler");
    this.#top = new Handler(handler);
  }

  wrap(layer) {
    const Kind = KINDS.get(layer);
    if (Kind === undefined) throw new RangeError("unknown layer");
    this.#top = new Kind(layer, this.#top);
    this.#wrapped.push(this.#top);
  }

  handle(path, token) {
    if (path === "" || token === "")
      throw new RangeError("empty path or token");
    const trace = [];
    const status = this.#top.serve(path, token, trace);
    trace.push(String(status));
    return trace;
  }

  layers() {
    return this.#wrapped.map((layer) => layer.name).reverse();
  }

  // The extension round: peeling the outermost layer off again.
  unwrap() {
    const outer = this.#wrapped.pop();
    if (outer === undefined) return false;
    this.#top = outer.inner;
    return true;
  }
}

module.exports = { HandlerStack };
