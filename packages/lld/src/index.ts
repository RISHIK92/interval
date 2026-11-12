// P5-W29-S01 (LLDQ-1; ADR-0040 PROPOSED): LLD battles' contracts, shared by the
// generators (W29-S02), the problem pipeline (W30) and, as generated JSON Schema and Go,
// the checker (W29-S03).
export { Check } from "./check";
export { Interface } from "./interface";
export { Expected, Problem, scenariosOf } from "./problem";
export { Call, checkScenario, ResultLine, Scenario } from "./scenario";
export { fits, formatType, parseType, type TypeAst } from "./types";
// The Go emitter, for other packages' contracts (packages/judge, ADR-0040).
export { goTypes } from "./go";
