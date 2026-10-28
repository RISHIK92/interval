import type { Chip } from "../../server/chips";
import { outHref, readHref } from "../../server/outbound";
import type { ReadingTarget } from "../../server/ports";

// A reading in the in-app reader when its page can be framed, else in the browser
// through /out; both count as a path open (no feed event) and lead back to the path.
export function ReadingLink(props: {
  reading: ReadingTarget;
  pathId: string;
  chip: Chip;
  // The feed's card shows it as its button, with its own words.
  className?: string;
  label?: string;
}) {
  const { reading: r, pathId, chip } = props;
  if (r.linkBroken)
    return (
      <span className="font-semibold text-ink-muted">
        {r.sectionTitle} (link broken)
      </span>
    );
  const className = props.className ?? "font-semibold text-select";
  return r.frameable ? (
    <a
      href={readHref({
        itemId: r.itemId,
        momentId: r.momentId,
        chip,
        from: { path: pathId },
      })}
      className={className}
    >
      {props.label ?? r.sectionTitle}
    </a>
  ) : (
    <a
      href={outHref({
        itemId: r.itemId,
        momentId: r.momentId,
        from: "path",
        target: "section",
      })}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {props.label ?? r.sectionTitle}
    </a>
  );
}
