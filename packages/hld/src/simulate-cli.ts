// `pnpm --filter @interval/hld simulate <problem.json> <design.json>` (P6-W37): one
// design through one problem's scenarios, as the official scorer and the canvas's
// preview run it (CANVAS-5), printed as JSON. For authoring problems and designs.
import { readFileSync } from "node:fs";
import { Design } from "./design";
import { HldProblem } from "./problem";
import { simulate } from "./simulate";

const [problemFile, designFile] = process.argv.slice(2);
if (problemFile === undefined || designFile === undefined) {
  console.error("usage: simulate <problem.json> <design.json>");
  process.exit(1);
}
const problem = HldProblem.parse(JSON.parse(readFileSync(problemFile, "utf8")));
const design = Design.parse(JSON.parse(readFileSync(designFile, "utf8")));
console.log(JSON.stringify(simulate(problem, design), null, 2));
