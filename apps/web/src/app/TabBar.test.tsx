import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TabBar } from "./TabBar";

// The design's five tabs (owner, 2026-10-26): Home, Paths, Play and Library work; the
// rest come with their phases and show as disabled meanwhile (overrides Q-P1-42's
// "hidden").
test.each(["home", "library", "paths", "play"] as const)(
  "on %s, five tabs, that one current",
  (current) => {
    const html = renderToStaticMarkup(
      <TabBar current={current} firstName={null} />,
    );
    for (const name of ["Home", "Explore", "Paths", "Play", "Library"]) {
      expect(html).toContain(name);
    }
    expect(html).toMatch(/<nav[^>]*aria-label="Main"/);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>/);
    expect(html).toMatch(/<a[^>]*href="\/library"[^>]*>/);
    expect(html).toMatch(/<a[^>]*href="\/paths"[^>]*>/);
    expect(html).toMatch(/<a[^>]*href="\/play"[^>]*>/);
    const currentHref = {
      home: "/",
      library: "/library",
      paths: "/paths",
      play: "/play",
    }[current];
    expect(html).toMatch(
      new RegExp(
        `<a[^>]*href="${currentHref}"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="${currentHref}"`,
      ),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  },
);

// P2-W10-S03: Paths works now; P3-W13-S01: Play too.
test("Explore and Leagues are not links, and say they're coming later", () => {
  const html = renderToStaticMarkup(<TabBar current="home" firstName={null} />);
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  for (const name of ["Explore", "Leagues"]) {
    expect(html).toContain(`${name}<span class="sr-only">Coming later</span>`);
  }
});

// ADR-0019: on wide screens the bar is the design's sidebar, with the wordmark,
// Leagues (web only) and the profile at the bottom; phones keep five tabs.
test("Leagues, the wordmark and the profile show only in the wide sidebar", () => {
  const html = renderToStaticMarkup(<TabBar current="home" firstName={null} />);
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
  // Home, Paths, Play, Library and the profile are the only links.
  expect(html.match(/<a /g)).toHaveLength(5);
});

// The design's profile row: the first name's initial and the name (owner, 2026-10-26).
test("the sidebar's profile shows the initial and first name, or a glyph", () => {
  const named = renderToStaticMarkup(<TabBar current="home" firstName="ada" />);
  expect(named).toMatch(
    /href="\/profile"[^>]*>.*?<span[^>]*aria-hidden="true"[^>]*>A<\/span>.*?ada.*?Profile and settings/,
  );
  const unnamed = renderToStaticMarkup(
    <TabBar current="home" firstName={null} />,
  );
  expect(unnamed).toMatch(/href="\/profile"[^>]*><svg/);
});
