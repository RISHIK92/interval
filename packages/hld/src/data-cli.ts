// `pnpm --filter @interval/hld data` (P6-W40, W41): rebuilds what's generated from the
// families: src/pool.json, the validated seeds matches draw from (HLDQ-3), and
// src/calibration.json, the designs the owner grades for the judge (CANVAS-6), which the
// worker's judge eval reads. Run it after changing a family or the engine; the tests
// fail while either file is stale.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "./families";
import { buildPool } from "./family";
import { calibrationCandidates } from "./judge";

const write = (name: string, data: unknown) => {
  const file = join(import.meta.dirname, name);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${file}`);
};
write("pool.json", buildPool(FAMILIES));
write("calibration.json", calibrationCandidates());
