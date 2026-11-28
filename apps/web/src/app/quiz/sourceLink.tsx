import { outHref, readHref } from "../../server/outbound";
import type { EstimateSource } from "../../server/ports";

// §6.1: where a game sends a player back to reading. An article (ADR-0058) opens in
// the in-app reader when its page can be framed and the player has an account
// (ADR-0029), else on the publisher's page; a hand-written question's page opens
// directly (AI-3).
export function sourceLink(
  source: EstimateSource,
  isGuest: boolean,
): { href: string; title: string; external: boolean } {
  if (source.kind === "page")
    return { href: source.url, title: source.title, external: true };
  const inApp = source.frameable && !isGuest;
  return {
    href: inApp
      ? readHref({
          itemId: source.itemId,
          // Counts no open event; a "from Play" attribution waits for the loop
          // metric (P3-W18-S03).
          from: "reader",
        })
      : outHref({ itemId: source.itemId, from: "reader", target: "article" }),
    title: source.articleTitle,
    external: !inApp,
  };
}

export function SourceAnchor({
  link,
  className,
}: {
  link: ReturnType<typeof sourceLink>;
  className: string;
}) {
  return (
    <a
      href={link.href}
      {...(link.external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
      className={className}
    >
      {link.title}
    </a>
  );
}
