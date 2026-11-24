// Q-WD-17 (owner, 2026-11-23): "Stuck?" hints, hand-written per problem in
// problems/lld/<slug>/hints.md: a nudge (a direction), an approach (the data structure
// or algorithm) and a code sketch (a pseudo-code skeleton, never a solution), each under
// its "## " heading in that order. The sketch is one fenced block, shown as written.
// What each costs is the game server's (services/game), which sends it to the page.
export const HINT_LEVELS = ["Nudge", "Approach", "Code sketch"] as const;

// The three levels' texts, in order; level n is [n - 1].
export type Hints = [string, string, string];

export function parseHints(markdown: string): Hints {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  for (const line of lines) {
    const heading = /^## (.*)$/.exec(line);
    if (heading !== null)
      sections.push({ heading: (heading[1] ?? "").trim(), body: [] });
    // Anything before the first heading (a PROVISIONAL note) is for the authors.
    else sections.at(-1)?.body.push(line);
  }
  if (sections.length !== HINT_LEVELS.length)
    throw new Error(
      `hints.md has ${String(sections.length)} sections, not the three levels`,
    );
  return HINT_LEVELS.map((name, i) => {
    const section = sections[i];
    if (section?.heading !== name)
      throw new Error(`hints.md's section ${String(i + 1)} should be ${name}`);
    const text = section.body.join("\n").trim();
    if (text === "") throw new Error(`hints.md's ${name} is empty`);
    if (name !== "Code sketch") return text;
    const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/.exec(text);
    if (fenced === null)
      throw new Error("hints.md's Code sketch is one fenced block");
    return fenced[1] ?? "";
  }) as Hints;
}
