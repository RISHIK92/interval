// Writes the web's token CSS from packages/tokens (ARCH-3, P4-W19-S02).
// Usage: node scripts/codegen.ts <out>
import { writeFileSync } from "node:fs";
import { toCss } from "../src/css.ts";

const [out] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: codegen.ts <out>");
writeFileSync(out, toCss());
