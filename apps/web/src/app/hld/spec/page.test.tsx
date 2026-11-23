import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import SpecPage from "./page";

// P6-W36 (CANVAS-4): the public spec sheet shows every component's numbers and the
// patch notes, without the client (it's the traffic, not a component you size).
test("the spec sheet lists the components, their numbers and the patch notes", () => {
  const html = renderToStaticMarkup(<SpecPage />);
  expect(html).toContain("Version 1.0");
  expect(html).toContain("provisional until launch");
  expect(html).toContain("Load balancer");
  expect(html).toContain("Stream processor");
  expect(html).toContain(
    "10,000 reads/s per instance; writes 2,000/s on the primary",
  );
  expect(html).toContain("99.90%");
  expect(html).not.toContain("The problem&#x27;s users");
  expect(html).toContain("Patch notes");
});

// The sheet is public and static: built once, with no request to read a session from,
// so it stands alone without the app's frame.
test("the spec sheet is static: no session read, no app frame", () => {
  const page = SpecPage();
  expect(page).not.toBeInstanceOf(Promise);
  expect(renderToStaticMarkup(page)).not.toContain('aria-label="Main"');
});
