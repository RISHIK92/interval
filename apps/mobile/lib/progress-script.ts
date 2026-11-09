import type { Marker } from "@interval/api-client";

// P4-W20-S03 (§5D): the script the reader injects into the publisher's page. It scrolls to
// the section once and reports how far the screen's bottom got from the section's start
// toward the next section's (or the page's end): it reads and scrolls, and never writes
// to the page. A string, not a function's source: Hermes keeps no source to stringify.
// Plain ES5, as old WebViews run it; the markers go in as JSON, never as code.
const SCRIPT = `(function (page, start, end) {
  "use strict";
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function words(text) {
    // Permalink glyphs some sites put in headings ("¶", "#", "§") aren't the heading.
    return String(text || "")
      .replace(/[\u00b6#\u00a7]/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
  }
  function find(marker) {
    if (marker.id !== undefined) return document.getElementById(marker.id);
    var want = words(marker.text);
    var headings = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for (var i = 0; i < headings.length; i++) {
      if (words(headings[i].textContent) === want) return headings[i];
    }
    return null;
  }
  // Injected on every load: only the section's own page is measured, not one a link in
  // it led to (the same path; the query and fragment may differ).
  function path(url) {
    return (url.origin + url.pathname).replace(/\\/+$/, "");
  }
  if (path(new URL(location.href)) !== path(new URL(page))) return;
  var from = find(start);
  var to = end === null ? null : find(end);
  if (from === null || (end !== null && to === null)) {
    post({ type: "unmeasurable" });
    return;
  }
  from.scrollIntoView();
  var furthest = -1;
  function report() {
    var top = from.getBoundingClientRect().top + window.scrollY;
    var bottom =
      to === null
        ? document.documentElement.scrollHeight
        : to.getBoundingClientRect().top + window.scrollY;
    if (bottom <= top) {
      // The end comes before the start: nothing to measure, said once.
      if (furthest === -1) post({ type: "unmeasurable" });
      furthest = 2;
      return;
    }
    var seen = (window.scrollY + window.innerHeight - top) / (bottom - top);
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

export function progressScript(
  page: string,
  start: Marker,
  end: Marker | null,
): string {
  // react-native-webview wants the injected code to end with a value.
  return `${SCRIPT}(${literal(page)}, ${literal(start)}, ${literal(end)});\ntrue;`;
}
