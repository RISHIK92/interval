import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import manifest from "./manifest";

// §4.2, Q-P1-31, P1-W5-S06: installable, with a placeholder icon (owner, 2026-10-26).
const PUBLIC = join(__dirname, "..", "..", "public");

function pngSize(path: string): [number, number] {
  const png = readFileSync(join(PUBLIC, path));
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("the manifest names the app, starts at home, and runs standalone", () => {
  expect(manifest()).toMatchObject({
    name: "Interval",
    short_name: "Interval",
    start_url: "/",
    display: "standalone",
    theme_color: "#1f2933",
    background_color: "#1f2933",
  });
});

test("every icon exists at the size it claims, and one is maskable", () => {
  const icons = manifest().icons ?? [];
  expect(icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of icons) {
    const [width, height] = pngSize(icon.src);
    expect(`${String(width)}x${String(height)}`).toBe(icon.sizes);
    expect(icon.type).toBe("image/png");
  }
});
