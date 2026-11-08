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
