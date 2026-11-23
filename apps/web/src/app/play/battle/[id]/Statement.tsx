import { type ReactNode, Fragment } from "react";

// An LLD problem's statement, written in the small part of Markdown the problem files use
// (problems/lld/<slug>/statement.md): headings, a "> " note, "- " lists that wrap onto
// indented lines and nest by indenting, paragraphs, and `code` and **bold** inside them. Drawn as the battle
// design's brief, not printed raw. The page's title already names the problem, so the
// statement's own first "# " heading is left out where asked.
export function Statement({
  markdown,
  dropTitle,
}: {
  markdown: string;
  dropTitle: boolean;
}) {
  const blocks = markdown
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+$/, ""))
    .filter((b) => b !== "")
    // A heading with its text straight under it: two blocks.
    .flatMap((b) => {
      const [first = "", ...rest] = b.split("\n");
      return /^#{1,6} /.test(first) && rest.length > 0
        ? [first, rest.join("\n")]
        : [b];
    });
  if (dropTitle && /^# /.test(blocks[0] ?? "")) blocks.shift();
  // A leading "> PROVISIONAL" note marks a statement the owner hasn't reviewed yet: it
  // is for the authors, and stays in the file until the review.
  if (/^> ?PROVISIONAL\b/.test(blocks[0] ?? "")) blocks.shift();
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed lg:text-[13px]">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: string }) {
  const heading = /^(#{1,6}) (.*)$/.exec(block);
  if (heading !== null)
    return (
      <h3 className="font-semibold text-ink">{inline(heading[2] ?? "")}</h3>
    );
  if (block.startsWith("> "))
    return (
      <p className="rounded-xl bg-well px-3 py-2 text-[13px] text-ink-muted lg:text-xs">
        {inline(join(block.split("\n").map((l) => l.replace(/^> ?/, ""))))}
      </p>
    );
  if (block.startsWith("- ")) return <List items={listOf(block)} />;
  return <p>{inline(join(block.split("\n")))}</p>;
}

type Item = { indent: number; text: string; items: Item[] };

// "- " starts an item; indented further than the item before, it's nested in it. Any
// other line carries on the deepest open item it is indented under (or, unindented, the
// deepest one, as Markdown's lazy lines do).
function listOf(block: string): Item[] {
  const top: Item[] = [];
  const open: Item[] = [];
  for (const line of block.split("\n")) {
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const item = /^ *- (.*)$/.exec(line);
    if (item !== null) {
      while ((open.at(-1)?.indent ?? -1) >= indent) open.pop();
      const next = { indent, text: item[1] ?? "", items: [] };
      (open.at(-1)?.items ?? top).push(next);
      open.push(next);
      continue;
    }
    const owner = open.findLast((o) => o.indent < indent) ?? open.at(-1);
    if (owner !== undefined) owner.text = join([owner.text, line]);
  }
  return top;
}

function List({ items, nested = false }: { items: Item[]; nested?: boolean }) {
  return (
    <ul className={`flex flex-col gap-1.5 ${nested ? "mt-1.5" : ""}`}>
      {items.map((item, i) => (
        <li key={i} className="relative pl-3.5">
          <span
            aria-hidden="true"
            className={`absolute top-[0.6em] left-0 size-1.5 rounded-full ${nested ? "border border-ink-muted" : "bg-ink-muted"}`}
          />
          {inline(item.text)}
          {item.items.length === 0 ? null : <List items={item.items} nested />}
        </li>
      ))}
    </ul>
  );
}

const join = (lines: string[]) =>
  lines
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");

// `code` and **bold**; anything else is text as written.
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code
          key={i}
          className="rounded-md bg-well px-1 py-px font-mono text-[0.9em] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}
