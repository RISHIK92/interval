import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import OfflinePage from "./page";

// Q-P1-31: the one page the service worker keeps; no session, no data.
test("the offline page explains, without touching the server", () => {
  expect(renderToStaticMarkup(<OfflinePage />)).toContain(
    "You&#x27;re offline. Interval needs a connection",
  );
});
