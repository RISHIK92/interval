import { BREAK_LENGTHS, type Preferences } from "./ports";

// Q-P1-16: the time chips are the break lengths; the chosen one lasts the session.
export const CHIP_COOKIE = "iv_chip";

export const CHIPS = BREAK_LENGTHS;
export type Chip = (typeof CHIPS)[number];

export function parseChip(value: unknown): Chip | null {
  return CHIPS.find((chip) => chip === value) ?? null;
}

// The link's chip, else the one chosen earlier this session, else onboarding's.
export function chipFor(
  param: string | string[] | undefined,
  cookie: string | undefined,
  preferences: Pick<Preferences, "breakLength">,
): Chip {
  // A repeated ?chip= counts by its first value, as the proxy reads it.
  const first = Array.isArray(param) ? param[0] : param;
  return parseChip(first) ?? parseChip(cookie) ?? preferences.breakLength;
}

// A chip's upper bound in minutes, from its value ("8-15" is 15): what "fits" means.
export function chipLimit(chip: Chip): number {
  return Number(chip.split("-")[1]);
}

export function chipLabel(chip: Chip): string {
  return `${chip.replace("-", "–")} min`;
}
