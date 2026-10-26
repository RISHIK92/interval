import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

// The design system (docs/wireframes/design-system.html, owner 2026-10-26): every role
// has its light value and its dark adaptation.
const css = readFileSync(join(__dirname, "globals.css"), "utf8");
const PUBLIC = join(__dirname, "..", "..", "public");

const ROLES: [string, string, string][] = [
  ["page", "#FFFFFF", "#0E1014"],
  ["well", "#F3F4F6", "#1A1D23"],
  ["track", "#E6E8EC", "#2A2E36"],
  ["hairline", "#E4E6EB", "#262A32"],
  ["ink", "#101217", "#F3F4F6"],
  ["ink-muted", "#666C78", "#8F95A1"],
  ["go", "#12A150", "#35D07F"],
  ["go-text", "#0B7A3E", "#35D07F"], // dark mode labels in the go colour itself
  ["select", "#3462E8", "#7B9CFF"],
  ["live", "#E5404A", "#FF6B72"],
  ["wrong", "#C62F38", "#FF7B82"],
  ["shadow", "rgba(16, 18, 23, 0.07)", "transparent"], // no shadows in dark
];

test.each(ROLES)("%s is %s in light and %s in dark", (role, light, dark) => {
  const declared = new RegExp(
    `--${role}:\\s*light-dark\\(\\s*(rgba\\([^)]*\\)|[^,]+?)\\s*,\\s*([^)]+?)\\s*\\);`,
    "i",
  ).exec(css);
  expect(declared, `--${role} is declared with light-dark()`).not.toBeNull();
  expect(declared?.[1]?.toLowerCase()).toBe(light.toLowerCase());
  expect(declared?.[2]?.toLowerCase()).toBe(dark.toLowerCase());
});

test("the theme follows the device unless a device setting picks one", () => {
  expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark/);
  expect(css).toMatch(/\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/);
  expect(css).toMatch(/\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/);
});

test.each([
  ["Outfit", "outfit-latin-wght-normal.woff2", "OFL-outfit.txt"],
  [
    "JetBrains Mono",
    "jetbrains-mono-latin-wght-normal.woff2",
    "OFL-jetbrains-mono.txt",
  ],
])("%s is self-hosted, with its licence", (family, file, licence) => {
  const font = readFileSync(join(PUBLIC, "fonts", file));
  expect(font.subarray(0, 4).toString("latin1")).toBe("wOF2");
  expect(readFileSync(join(PUBLIC, "fonts", licence), "utf8")).toContain(
    "SIL Open Font License",
  );
  expect(css).toContain(`font-family: "${family}"`);
  expect(css).toContain(`url("/fonts/${file}") format("woff2")`);
});
