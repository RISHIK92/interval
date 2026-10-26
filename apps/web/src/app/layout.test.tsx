import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

// The device's theme reaches the page before it paints (owner, 2026-10-26).
const get = vi.fn<(name: string) => { value: string } | undefined>();
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get }) }));
vi.mock("./PwaSetup", () => ({ PwaSetup: () => null }));
vi.mock("./globals.css", () => ({}));

test.each([
  ["dark", "dark"],
  ["light", "light"],
  [undefined, "system"],
  ["neon", "system"],
])("cookie %s gives data-theme %s", async (cookie, theme) => {
  get.mockReturnValue(cookie === undefined ? undefined : { value: cookie });
  const { default: RootLayout } = await import("./layout");
  const html = renderToStaticMarkup(await RootLayout({ children: <p>hi</p> }));
  expect(html).toContain(`data-theme="${theme}"`);
  expect(get).toHaveBeenCalledWith("iv_theme");
});

// Chrome fetches a manifest without cookies unless told to; behind a tunnel that gates
// on a cookie (ngrok's warning page) the app then can't be installed (owner, 2026-10-26).
test("the manifest link sends credentials", async () => {
  get.mockReturnValue(undefined);
  const { default: RootLayout } = await import("./layout");
  const html = renderToStaticMarkup(await RootLayout({ children: <p>hi</p> }));
  expect(html).toContain(
    '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"/>',
  );
});
