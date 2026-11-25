const OK = 200;
const UNAUTHORIZED = 401;
const BEARER = "Bearer ";

// The innermost handler: it serves every request it's given.
class Handler {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  serve(path: string, token: string, trace: string[]): number {
    trace.push(`${this.name} ${path}`);
    return OK;
  }
}

// A decorator: it looks like a handler, holds the one it wraps, and adds its own lines
// around the call. Subclasses change only the part they're about.
class Layer extends Handler {
  readonly inner: Handler;

  constructor(name: string, inner: Handler) {
    super(name);
    this.inner = inner;
  }

  override serve(path: string, token: string, trace: string[]): number {
    trace.push(this.entered());
    const status = this.inside(path, token, trace);
    trace.push(this.left(status));
    return status;
  }

  protected entered(): string {
    return `enter ${this.name}`;
  }

  protected inside(path: string, token: string, trace: string[]): number {
    return this.inner.serve(path, token, trace);
  }

  protected left(_status: number): string {
    return `leave ${this.name}`;
  }
}

class Auth extends Layer {
  protected override inside(
    path: string,
    token: string,
    trace: string[],
  ): number {
    if (!token.startsWith(BEARER) || token.length === BEARER.length) {
      trace.push("deny");
      return UNAUTHORIZED;
    }
    return super.inside(path, token, trace);
  }
}

class RequestId extends Layer {
  private seen = 0;

  protected override entered(): string {
    this.seen += 1;
    return `${super.entered()} ${String(this.seen)}`;
  }
}

class Compress extends Layer {
  protected override left(status: number): string {
    return status === OK ? `${super.left(status)} gzip` : super.left(status);
  }
}

const KINDS = new Map<string, new (name: string, inner: Handler) => Layer>([
  ["auth", Auth],
  ["request-id", RequestId],
  ["compress", Compress],
]);

// A handler wrapped in layers, the last one wrapped outermost.
export class HandlerStack {
  private top: Handler;
  private readonly wrapped: Layer[] = [];

  constructor(handler: string) {
    if (handler === "") throw new RangeError("empty handler");
    this.top = new Handler(handler);
  }

  wrap(layer: string): void {
    const Kind = KINDS.get(layer);
    if (Kind === undefined) throw new RangeError("unknown layer");
    const outer = new Kind(layer, this.top);
    this.wrapped.push(outer);
    this.top = outer;
  }

  handle(path: string, token: string): string[] {
    if (path === "" || token === "")
      throw new RangeError("empty path or token");
    const trace: string[] = [];
    const status = this.top.serve(path, token, trace);
    trace.push(String(status));
    return trace;
  }

  layers(): string[] {
    return this.wrapped.map((layer) => layer.name).reverse();
  }

  // The extension round: peeling the outermost layer off again.
  unwrap(): boolean {
    const outer = this.wrapped.pop();
    if (outer === undefined) return false;
    this.top = outer.inner;
    return true;
  }
}
