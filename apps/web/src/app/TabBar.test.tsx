import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TabBar } from "./TabBar";

// The design's five tabs (owner, 2026-10-26): Home and Library work; the rest come
// with their phases and show as disabled meanwhile (overrides Q-P1-42's "hidden").
test.each(["home", "library"] as const)(
  "on %s, five tabs, that one current",
  (current) => {
    const html = renderToStaticMarkup(<TabBar current={current} />);
    for (const name of ["Home", "Explore", "Paths", "Play", "Library"]) {
      expect(html).toContain(name);
    }
    expect(html).toMatch(/<nav[^>]*aria-label="Main"/);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>/);
    expect(html).toMatch(/<a[^>]*href="\/library"[^>]*>/);
    const currentHref = current === "home" ? "/" : "/library";
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="${currentHref}"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="${currentHref}"`,
      ),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  },
);

test("Explore, Paths, Play and Leagues are not links, and say they're coming later", () => {
  const html = renderToStaticMarkup(<TabBar current="home" />);
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
  for (const name of ["Explore", "Paths", "Play", "Leagues"]) {
    expect(html).toContain(`${name}<span class="sr-only">Coming later</span>`);
  }
});

// ADR-0019: on wide screens the bar is the design's sidebar, with the wordmark,
// Leagues (web only) and the profile at the bottom; phones keep five tabs.
test("Leagues, the wordmark and the profile show only in the wide sidebar", () => {
  const html = renderToStaticMarkup(<TabBar current="home" />);
  // Hidden on phones, shown in the sidebar: the class has both.
  const wide = String.raw`class="(?=[^"]*\bhidden\b)(?=[^"]*lg:flex)[^"]*"`;
  // Anchored on the Leagues item itself: its span, its icon, its name.
  expect(html).toMatch(
    new RegExp(`<span aria-disabled="true" ${wide}><svg[^]*?</svg>Leagues<`),
  );
  expect(html).toMatch(new RegExp(`<span[^>]*${wide}[^>]*>.*?Interval`));
  expect(html).toMatch(
    new RegExp(
      `<a(?=[^>]*href="/profile")[^>]*${wide}[^>]*>.*?Profile and settings`,
    ),
  );
  // Home, Library and the profile are the only links.
  expect(html.match(/<a /g)).toHaveLength(3);
});
