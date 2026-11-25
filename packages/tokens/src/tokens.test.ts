import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { colors, families, palette, type } from "./tokens.ts";

// P4-W19-S02 (ARCH-3): one set of tokens for both apps.
const web = (file: string) =>
  readFileSync(
    new URL(`../../../apps/web/src/app/${file}`, import.meta.url),
    "utf8",
  );

test("every role has a light and a dark value", () => {
  for (const pair of [
    ...Object.values(colors),
    ...Object.values(families).flatMap((f) => Object.values(f)),
  ]) {
    expect(pair.light).not.toBe("");
    expect(pair.dark).not.toBe("");
  }
  expect(palette("dark").page).toBe("#0e1014");
  expect(palette("light").ink).toBe("#101217");
});

test("the web's committed token CSS is what the tokens generate", () => {
  const dir = mkdtempSync(join(tmpdir(), "tokens-"));
  const out = join(dir, "tokens.css");
  execFileSync(
    fileURLToPath(new URL("../scripts/codegen.sh", import.meta.url)),
    [out],
  );
  const generated = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true });
  expect(web("tokens.css")).toBe(generated);
});

test("the web's type utilities have the tokens' sizes", () => {
  const css = web("globals.css");
  for (const [name, t] of Object.entries(type)) {
    const block = new RegExp(`@utility text-${name} \\{([^}]*)\\}`).exec(
      css,
    )?.[1];
    expect(block, name).toContain(`font-size: ${String(t.size)}px;`);
    expect(block, name).toContain(`font-weight: ${String(t.weight)};`);
    expect(block, name).toContain(`line-height: ${String(t.lineHeight)};`);
    if (t.letterSpacing !== 0)
      expect(block, name).toContain(
        `letter-spacing: ${String(t.letterSpacing)}em;`,
      );
  }
});

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// ADR-0049 (owner, 2026-11-25): software design has its own family, not a borrowed one,
// and its line colour reads as text on its tint (WCAG AA) in both schemes.
test("software design has its own colour family, legible on its tint", () => {
  const own = families["software-design"];
  for (const [name, other] of Object.entries(families))
    if (name !== "software-design")
      expect(other.right.light, name).not.toBe(own.right.light);
  for (const scheme of ["light", "dark"] as const)
    expect(
      contrast(own.line[scheme], own.tint[scheme]),
      scheme,
    ).toBeGreaterThanOrEqual(4.5);
});
