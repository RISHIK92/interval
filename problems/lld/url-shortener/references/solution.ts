const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class UrlShortener {
  // Every live code (generated or custom) to its url and hit count.
  private readonly urls = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  // A url's generated code, so shortening it again gives the same one.
  private readonly generated = new Map<string, string>();
  private counter = 1;

  private static checkUrl(url: string): void {
    const rest = url.startsWith("https://")
      ? url.slice(8)
      : url.startsWith("http://")
        ? url.slice(7)
        : "";
    if (rest === "" || url.length > 2048 || url.includes(" "))
      throw new RangeError("invalid url");
  }

  private static encode(n: number): string {
    let out = "";
    while (n > 0) {
      out = ALPHABET.charAt(n % 62) + out;
      n = Math.floor(n / 62);
    }
    return out;
  }

  shorten(url: string): string {
    UrlShortener.checkUrl(url);
    const known = this.generated.get(url);
    if (known !== undefined) return known;
    // A custom alias may already hold the next code: skip it.
    let code: string;
    do {
      code = UrlShortener.encode(this.counter++);
    } while (this.urls.has(code));
    this.urls.set(code, url);
    this.counts.set(code, 0);
    this.generated.set(url, code);
    return code;
  }

  expand(code: string): string {
    const url = this.urls.get(code);
    if (url === undefined) throw new RangeError("unknown code");
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
    return url;
  }

  custom(url: string, alias: string): string {
    UrlShortener.checkUrl(url);
    if (!/^[0-9a-zA-Z]{1,16}$/.test(alias))
      throw new RangeError("invalid alias");
    if (this.urls.has(alias)) throw new RangeError("alias taken");
    this.urls.set(alias, url);
    this.counts.set(alias, 0);
    return alias;
  }

  hits(code: string): number {
    const n = this.counts.get(code);
    if (n === undefined) throw new RangeError("unknown code");
    return n;
  }

  expire(code: string): void {
    const url = this.urls.get(code);
    if (url === undefined) throw new RangeError("unknown code");
    this.urls.delete(code);
    this.counts.delete(code);
    if (this.generated.get(url) === code) this.generated.delete(url);
  }
}
