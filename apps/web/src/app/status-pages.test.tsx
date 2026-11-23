// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import ErrorPage from "./error";
import Loading from "./loading";
import NotFound from "./not-found";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A link to nothing (an ended match, a typo) says so in the app's frame and leads back.
test("not found says so and leads back to Play and Home", () => {
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toContain("This page isn&#x27;t here");
  expect(html).toContain('href="/play"');
  expect(html).toContain('href="/"');
  expect(html).toContain("<nav"); // the sidebar and tab bar
});

// A failed page: a retry that re-renders it, a way home, and the error in the console.
test("an error offers a retry and home, and logs the error", () => {
  const reset = vi.fn();
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<ErrorPage error={new Error("boom")} reset={reset} />);
  });
  expect(host.textContent).toContain("Something went wrong");
  expect(host.querySelector('a[href="/"]')).not.toBeNull();
  const retry = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Try again",
  );
  act(() => {
    retry?.click();
  });
  expect(reset).toHaveBeenCalledOnce();
  expect(logged).toHaveBeenCalled();
  act(() => {
    root.unmount();
  });
  logged.mockRestore();
});

// Loading: announced once to screen readers, with blocks that hold the page's shape.
test("loading is announced and holds the page's shape", () => {
  const html = renderToStaticMarkup(<Loading />);
  expect(html).toContain('role="status"');
  expect(html).toContain("Loading…");
  expect(html).toContain("motion-safe:animate-pulse");
});
