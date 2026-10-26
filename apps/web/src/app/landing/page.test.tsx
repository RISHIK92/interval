import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import LandingPage from "./page";

// Public: renders with no session or server. Every way in is /join, except "Open the
// web app" and the footer's "Web games", which go to the app (owner, 2026-10-26).
test("the landing page sends visitors to join, and members to the app", () => {
  const html = renderToStaticMarkup(<LandingPage />);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
  const anchors = hrefs.filter((h) => h.startsWith("#"));
  expect(hrefs.filter((h) => h === "/")).toHaveLength(2);
  expect(hrefs.filter((h) => h === "/join").length).toBeGreaterThan(0);
  expect(
    hrefs.filter((h) => h !== "/" && h !== "/join" && !h.startsWith("#")),
  ).toEqual([]);
  for (const a of anchors) expect(html).toContain(`id="${a.slice(1)}"`);
});
