// The incident API's severities as the legacy pager's levels, and back: five levels fold
// into three severities.
const TO_LEVEL = new Map([
  ["sev1", "1"],
  ["sev2", "3"],
  ["sev3", "5"],
]);
const TO_SEVERITY = new Map([
  ["1", "sev1"],
  ["2", "sev1"],
  ["3", "sev2"],
  ["4", "sev3"],
  ["5", "sev3"],
]);
const MAX_CODE = 9999;

interface Page {
  readonly team: string;
  readonly code: string;
  acked: boolean;
}

// Lets the incident API (team names, sev1 to sev3) drive a legacy pager (numeric team
// codes, levels 1 to 5): pages go out as legacy lines, and the pager's acknowledgements
// come back as the API's words. Numbers are kept as the text the pager sees.
export class PagerAdapter {
  private readonly codes = new Map<string, string>();
  private readonly sent = new Map<string, Page>();

  constructor(teamCodes: Record<string, number>) {
    for (const [team, code] of Object.entries(teamCodes)) {
      if (team === "" || code < 1 || code > MAX_CODE)
        throw new RangeError("bad team or code");
      this.codes.set(team, String(code));
    }
    if (new Set(this.codes.values()).size !== this.codes.size)
      throw new RangeError("two teams share a code");
  }

  page(team: string, severity: string, summary: string): string {
    const code = this.codes.get(team);
    const level = TO_LEVEL.get(severity);
    if (code === undefined || level === undefined || summary === "")
      throw new RangeError("unknown team or severity, or no summary");
    const number = String(this.sent.size + 1);
    this.sent.set(number, { team, code, acked: false });
    return `PAGE ${number} ${code} ${level} ${summary}`;
  }

  ack(legacyLine: string): string | null {
    if (legacyLine === "") throw new RangeError("empty line");
    const fields = legacyLine.split(" ");
    if (fields.length !== 4 || fields[0] !== "ACK") return null;
    const [, number, code, level] = fields as [string, string, string, string];
    const page = this.sent.get(number);
    const severity = TO_SEVERITY.get(level);
    if (
      page === undefined ||
      page.acked ||
      page.code !== code ||
      severity === undefined
    )
      return null;
    page.acked = true;
    return `${page.team} acked page ${number} at ${severity}`;
  }

  pages(): number {
    return this.sent.size;
  }
}
