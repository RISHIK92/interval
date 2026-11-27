import type { AgentStatus } from "@interval/api-client";
import { onSite, type Site } from "./site";

type Choice = { readonly label: string; readonly url: string };

// A title comes from a publisher's feed: its control characters (which could fake a
// line) and format characters (bidi overrides and zero-width ones, which could hide or
// reorder text) are dropped before it's shown, as `interval status` drops the former.
export function printable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

// A QuickPick label renders "$(name)" as an icon; escaped, a title can't draw one.
function literal(text: string): string {
  return text.replaceAll("$(", "\\$(");
}

// The suggestions that may open: on the configured site only.
export function choices(status: AgentStatus, site: Site): Choice[] {
  return status.suggestions.flatMap((suggestion) => {
    const url = onSite(site, suggestion.url);
    if (url === null) return [];
    const title = literal(printable(suggestion.title));
    return [
      {
        label:
          suggestion.minutes === null
            ? title
            : `${title} · ${String(suggestion.minutes)} min`,
        url,
      },
    ];
  });
}
