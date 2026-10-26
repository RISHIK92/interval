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

test("Explore, Paths and Play are not links, and say they're coming later", () => {
  const html = renderToStaticMarkup(<TabBar current="home" />);
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
  expect(html.match(/<a /g)).toHaveLength(2);
  for (const name of ["Explore", "Paths", "Play"]) {
    expect(html).toContain(`${name}<span class="sr-only">Coming later</span>`);
  }
});
