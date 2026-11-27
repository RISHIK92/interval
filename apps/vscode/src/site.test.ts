import { expect, test } from "vitest";
import { homeUrl, onSite, readSite, type Site, statusUrl } from "./site";

function site(raw: string): Site {
  const setting = readSite(raw);
  if (setting.kind !== "ok") throw new Error(`expected ${raw} to be accepted`);
  return setting.site;
}

test("https sites, and plain http to this machine only, are accepted", () => {
  for (const raw of [
    "https://interval.example",
    "https://interval.example/",
    "  https://interval.example/app/  ",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
    "http://[::1]:3100",
  ]) {
    expect(readSite(raw).kind, raw).toBe("ok");
  }
});

test("anything else is refused with the reason", () => {
  for (const raw of [
    "http://interval.example",
    "http://localhost.interval.example",
    "ftp://interval.example",
    "localhost:3100",
    "interval.example",
    "https://user:secret@interval.example",
    "https://interval.example/?next=evil",
    "https://interval.example/#x",
  ]) {
    const setting = readSite(raw);
    expect(setting.kind, raw).toBe("refused");
    if (setting.kind === "refused")
      expect(setting.reason).toMatch(/^interval\.url is refused: /);
  }
});

test("an empty setting is unset, not refused", () => {
  expect(readSite("").kind).toBe("unset");
  expect(readSite("   ").kind).toBe("unset");
});

test("the status and Home addresses keep the site's path and carry the chip", () => {
  const atRoot = site("https://interval.example/");
  expect(statusUrl(atRoot, undefined)).toBe(
    "https://interval.example/api/agent/status",
  );
  expect(statusUrl(atRoot, "3-8")).toBe(
    "https://interval.example/api/agent/status?chip=3-8",
  );
  expect(homeUrl(atRoot, "8-15")).toBe("https://interval.example/?chip=8-15");
  expect(homeUrl(atRoot, undefined)).toBe("https://interval.example/");
  const underPath = site("https://example.org/interval/");
  expect(statusUrl(underPath, "1-3")).toBe(
    "https://example.org/interval/api/agent/status?chip=1-3",
  );
  expect(homeUrl(underPath, "1-3")).toBe(
    "https://example.org/interval/?chip=1-3",
  );
});

test("only links on the site's own origin may open", () => {
  const configured = site("https://interval.example");
  expect(
    onSite(configured, "https://interval.example/read/10?moment=1&via=agent"),
  ).toBe("https://interval.example/read/10?moment=1&via=agent");
  for (const raw of [
    "https://evil.example/read/10",
    "http://interval.example/read/10",
    "https://interval.example:8443/read/10",
    "https://interval.example.evil.example/",
    "javascript:alert(1)",
    "/read/10",
    "not a url",
  ]) {
    expect(onSite(configured, raw), raw).toBeNull();
  }
});
