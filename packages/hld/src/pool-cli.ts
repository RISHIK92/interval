// `pnpm --filter @interval/hld pool` (P6-W40, HLDQ-3): rebuilds src/pool.json, the
// validated seeds matches draw from. Run it after changing a family or the engine;
// families.test.ts fails while the file is stale.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "./families";
import { buildPool } from "./family";

const file = join(import.meta.dirname, "pool.json");
writeFileSync(file, `${JSON.stringify(buildPool(FAMILIES), null, 2)}\n`);
console.log(`wrote ${file}`);
