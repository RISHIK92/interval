import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Requirements } from "./Frame";

// Q-WD-15: each requirement says whether the design covers it, and by what.
test("requirements show what's covered, by what, and the count", () => {
  const html = renderToStaticMarkup(
    <Requirements
      coverage={{
        covered: 1,
        total: 2,
        items: [
          { text: "Redirect fast", covered: true, by: "Cache, 3 nodes" },
          { text: "Survive a zone outage", covered: false, by: null },
        ],
      }}
    />,
  );
  expect(html).toContain("1 of 2 covered");
  expect(html).toContain(
    'aria-label="Redirect fast: covered by Cache, 3 nodes"',
  );
  expect(html).toContain("Cache, 3 nodes");
  expect(html).toContain(
    'aria-label="Survive a zone outage: nothing covers this yet"',
  );
  expect(html).toContain("Nothing covers this yet");
});
