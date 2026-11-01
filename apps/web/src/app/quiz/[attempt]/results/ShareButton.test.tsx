import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ShareButton, shareLink } from "./ShareButton";

// P3-W13-S06 (owner, 2026-11-01): phones open the share sheet; elsewhere the link is
// copied. The click itself is checked in the browser: no DOM test environment here.
const URL_TEXT = "https://interval.example/daily/abc";

test("opens the share sheet with the link where there is one", async () => {
  const share = vi.fn(() => Promise.resolve());
  const writeText = vi.fn(() => Promise.resolve());
  expect(await shareLink(URL_TEXT, { share, clipboard: { writeText } })).toBe(
    null,
  );
  expect(share).toHaveBeenCalledWith({ url: URL_TEXT });
  expect(writeText).not.toHaveBeenCalled();
});

test("a share sheet the player closes says nothing", async () => {
  const share = vi.fn(() =>
    Promise.reject(new DOMException("cancelled", "AbortError")),
  );
  expect(
    await shareLink(URL_TEXT, { share, clipboard: { writeText: vi.fn() } }),
  ).toBe(null);
});

test("copies the link without a share sheet", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  expect(await shareLink(URL_TEXT, { clipboard: { writeText } })).toBe(
    "Link copied",
  );
  expect(writeText).toHaveBeenCalledWith(URL_TEXT);
});

test("says so when sharing fails", async () => {
  const writeText = vi.fn(() => Promise.reject(new Error("denied")));
  expect(await shareLink(URL_TEXT, { clipboard: { writeText } })).toBe(
    "Couldn't share",
  );
});

test("a share sheet that fails falls back to copying", async () => {
  const share = vi.fn(() =>
    Promise.reject(new DOMException("blocked", "NotAllowedError")),
  );
  const copied = vi.fn(() => Promise.resolve());
  expect(
    await shareLink(URL_TEXT, { share, clipboard: { writeText: copied } }),
  ).toBe("Link copied");
  expect(copied).toHaveBeenCalledWith(URL_TEXT);
  const denied = vi.fn(() => Promise.reject(new Error("denied")));
  expect(
    await shareLink(URL_TEXT, { share, clipboard: { writeText: denied } }),
  ).toBe("Couldn't share");
});

test("it is a button with a place for what happened", () => {
  const html = renderToStaticMarkup(<ShareButton shareId="abc" />);
  expect(html).toContain("Share your result");
  expect(html).toContain('role="status"');
});
