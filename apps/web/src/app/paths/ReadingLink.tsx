import { outHref, readHref } from "../../server/outbound";
import type { ReadingTarget } from "../../server/ports";

// A reading in the in-app reader when its page can be framed, else in the browser
// through /out; both count as a path open (no feed event) and lead back to the path.
// ADR-0058: a reading is a whole article, named by its title.
export function ReadingLink(props: {
  reading: ReadingTarget;
  pathId: string;
  // The feed's card shows it as its button, with its own words.
  className?: string;
  label?: string;
}) {
  const { reading: r, pathId } = props;
  if (r.linkBroken)
    return (
      <span className="font-semibold text-ink-muted">
        {r.articleTitle} (link broken)
      </span>
    );
  const className = props.className ?? "font-semibold text-select";
  return r.frameable ? (
    <a
      href={readHref({ itemId: r.itemId, from: { path: pathId } })}
      className={className}
    >
      {props.label ?? r.articleTitle}
    </a>
  ) : (
    <a
      href={outHref({ itemId: r.itemId, from: "path", target: "article" })}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {props.label ?? r.articleTitle}
    </a>
  );
}
