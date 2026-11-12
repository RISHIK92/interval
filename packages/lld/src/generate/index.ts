import type { Interface } from "../interface";
import type { Generated } from "./common";
import { cpp } from "./cpp";
import { go } from "./go";
import { java } from "./java";
import { javascript, typescript } from "./javascript";
import { python } from "./python";

// P5-W29-S02 (LLDQ-1): starter code and harnesses for every launch language (C-04).
export const GENERATORS: Record<string, (iface: Interface) => Generated> = {
  python,
  javascript,
  typescript,
  java,
  cpp,
  go,
};

// The files one run needs: the submission (the player's code) and the harness.
export function runFiles(
  language: string,
  iface: Interface,
  submission: string,
): Record<string, string> {
  const generate = GENERATORS[language];
  if (generate === undefined) throw new Error(`no generator for ${language}`);
  const g = generate(iface);
  return { [g.solutionFile]: submission, [g.harnessFile]: g.harness };
}

export type { Generated } from "./common";
