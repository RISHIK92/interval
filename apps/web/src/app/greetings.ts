import type { Chip } from "../server/chips";

// Home's greeting (ADR-0019): short, nerdy, a little meme-y, picked from what Interval
// knows. Add lines as context grows (streaks, GitHub, …); each says when it fits.
export type GreetingContext = {
  hour: number; // the device's, 0–23
  weekday: number; // 0 is Sunday
  firstName: string | null;
  chip: Chip;
  continuing: string | null; // the first Continue card's section title
};

type Part = "late" | "morning" | "afternoon" | "evening" | "night";

function partOf(hour: number): Part {
  if (hour < 5) return "late";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

type Line = {
  when: (c: GreetingContext, part: Part) => boolean;
  text: (c: GreetingContext, name: string) => string;
};

const at =
  (...parts: Part[]) =>
  (_: GreetingContext, part: Part) =>
    parts.includes(part);
const always = () => true;

// `name` is ", Ada" or "": every line reads right without one.
const LINES: Line[] = [
  {
    when: at("late"),
    text: (_, n) => `It's late${n}. Consensus says: one more section.`,
  },
  { when: at("late"), text: () => "sudo sleep? Permission denied." },
  {
    when: at("late", "night"),
    text: () => "Night shift. No pager, just reading.",
  },
  { when: at("morning"), text: (_, n) => `Morning${n}. Cache is warm.` },
  { when: at("morning"), text: () => "GET /coffee 200 OK." },
  {
    when: at("morning"),
    text: (_, n) => `Morning${n}. Brain finished booting.`,
  },
  {
    when: at("afternoon"),
    text: () => "Afternoon slump detected. Patching with knowledge.",
  },
  { when: at("afternoon"), text: (_, n) => `Post-lunch GC pause${n}?` },
  {
    when: at("evening"),
    text: (_, n) => `Evening${n}. Prod is quiet. Probably.`,
  },
  {
    when: at("evening", "night"),
    text: () => "Merged for the day? One more read.",
  },
  {
    when: (c) => c.weekday === 1,
    text: (_, n) => `Monday.exe is loading${n}.`,
  },
  { when: (c) => c.weekday === 5, text: () => "Friday deploy? Read first." },
  {
    when: (c) => c.weekday === 0 || c.weekday === 6,
    text: (_, n) => `Weekend mode${n}. Zero standups.`,
  },
  { when: (c) => c.chip === "1-3", text: () => "3 minutes. Speedrun any%." },
  {
    when: (c) => c.chip === "8-15",
    text: () => "15 minutes. Practically a sprint.",
  },
  {
    when: (c) => c.continuing !== null,
    text: (c) => `You left “${c.continuing ?? ""}” on read.`,
  },
  { when: always, text: (_, n) => `Hello, world${n}.` },
  { when: always, text: () => "It works on my machine. Let's learn why." },
];

export function linesFor(context: GreetingContext): string[] {
  const part = partOf(context.hour);
  const name = context.firstName === null ? "" : `, ${context.firstName}`;
  return LINES.filter((line) => line.when(context, part)).map((line) =>
    line.text(context, name),
  );
}

// One line per day and part of day, so a refresh doesn't reshuffle it. A new chip
// or a new Continue card changes the pool, and may change the line: that's fine.
export function greeting(context: GreetingContext, day: string): string {
  const lines = linesFor(context);
  const seed = `${day}|${partOf(context.hour)}`;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return lines[hash % lines.length] ?? "Hello, world.";
}
