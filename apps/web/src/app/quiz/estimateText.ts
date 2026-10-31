import { missed } from "../../server/estimation";

// P3-W13-S04 (C-27): how an estimate reads on the quiz page and the results.
export const amount = (n: number, unit: string): string =>
  `${n.toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${unit}`;

// Words, never colour alone (wireframe 12).
export const verdict = (score: number): string =>
  score === 1 ? "Full points" : missed(score) ? "Way off" : "Close";
