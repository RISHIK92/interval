// P4-W20-S03 (§5D): the script the reader injects into the publisher's page. It reports
// how far down the page the screen's bottom has got (ADR-0058: the whole article): it
// reads, and never scrolls or writes to the page. A string, not a function's source:
// Hermes keeps no source to stringify. Plain ES5, as old WebViews run it; the page's
// address goes in as JSON, never as code.
const SCRIPT = `(function (page) {
  "use strict";
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  // Injected on every load: only the article's own page is measured, not one a link in
  // it led to (the same path; the query and fragment may differ).
  function path(url) {
    return (url.origin + url.pathname).replace(/\\/+$/, "");
  }
  if (path(new URL(location.href)) !== path(new URL(page))) return;
  var furthest = -1;
  function report() {
    var height = document.documentElement.scrollHeight;
    var seen = height <= 0 ? 1 : (window.scrollY + window.innerHeight) / height;
    seen = Math.max(0, Math.min(1, seen));
    // Every new furthest point: the app decides what is read through.
    if (seen > furthest) {
      furthest = seen;
      post({ type: "progress", value: seen });
    }
  }
  window.addEventListener("scroll", report, { passive: true });
  report();
})`;

// JSON, with the two line separators older engines reject inside a string escaped.
const literal = (value: unknown) =>
  JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export function progressScript(page: string): string {
  // react-native-webview wants the injected code to end with a value.
  return `${SCRIPT}(${literal(page)});\ntrue;`;
}
