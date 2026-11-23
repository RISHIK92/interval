import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Button, buttonClass } from "./Button";

// Keyboard users see where they are: every variant draws the select ring, set off from
// the pill so it shows on the black one too.
test("every button variant shows a focus ring off its edge", () => {
  for (const variant of ["act", "secondary"] as const) {
    const html = renderToStaticMarkup(<Button variant={variant}>Go</Button>);
    for (const ring of [
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-select",
    ]) {
      expect(html).toContain(ring);
      expect(buttonClass(variant)).toContain(ring);
    }
  }
});
