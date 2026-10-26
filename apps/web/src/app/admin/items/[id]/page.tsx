import { notFound } from "next/navigation";
import { adminReview } from "../../../../server/container";
import type { SaveError } from "../../../../server/admin-review";
import type { ReviewTags } from "../../../../server/ports";
import { Card } from "../../../ui/Card";
import { FIELD } from "../../../ui/field";
import { requireAdmin } from "../../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../../style";
import { saveBoundariesAction, saveTagsAction } from "./actions";

export const dynamic = "force-dynamic";

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

// Fixed text per code (server/admin-review.ts): the query string chooses which, never
// what it says.
const ERRORS: Record<SaveError, string> = {
  "no-item": "That item no longer exists.",
  "unknown-heading": "Not a heading of this item:",
  "not-a-moment": "That heading doesn't start a moment any more.",
  "bad-tags": "Pick a level and at most five concepts.",
  "unknown-concept": "Not in the concept graph:",
};

function isSaveError(code: string | undefined): code is SaveError {
  return code !== undefined && Object.hasOwn(ERRORS, code);
}

function list(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : [value].flat();
}

function describe(tags: ReviewTags | null | undefined): string {
  if (!tags) return "none";
  const concepts =
    tags.concepts.length > 0 ? tags.concepts.join(", ") : "no concepts";
  return `${tags.difficulty} · ${concepts}`;
}

function TagForm(props: {
  itemId: string;
  heading: string;
  model: ReviewTags | null | undefined;
  override: ReviewTags | undefined;
}) {
  const current = props.override ?? props.model;
  return (
    <form
      action={saveTagsAction}
      className="mt-2 flex flex-wrap items-end gap-3 text-sm"
    >
      <input type="hidden" name="itemId" value={props.itemId} />
      <input type="hidden" name="heading" value={props.heading} />
      <p className="w-full text-ink-muted">
        Model: {describe(props.model)}
        {props.override ? ` · Override: ${describe(props.override)}` : ""}
      </p>
      <label>
        Level{" "}
        <select
          className={FIELD}
          name="difficulty"
          defaultValue={current?.difficulty ?? "intermediate"}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>{" "}
      <label className="min-w-64 flex-1">
        Concepts (slugs, comma-separated){" "}
        <input
          className={FIELD}
          name="concepts"
          list="concepts"
          defaultValue={current?.concepts.join(", ") ?? ""}
        />
      </label>{" "}
      <button type="submit" name="intent" value="save" className={ACT}>
        Save
      </button>
      {props.override ? (
        <button type="submit" name="intent" value="clear" className={SECONDARY}>
          Clear override
        </button>
      ) : null}
    </form>
  );
}

// ING-6, P1-W3-S05: review one item's section boundaries and tags. Corrections are
// overrides, kept apart from the model's output and surviving re-ingestion.
export default async function ReviewItemPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    detail?: string | string[];
  }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const { saved, error, detail } = await props.searchParams;
  const review = adminReview();
  const [item, concepts] = await Promise.all([
    review.item(id),
    review.activeConcepts(),
  ]);
  if (item === null) notFound();
  const boundaries = new Set(item.boundaries ?? []);
  const headings = new Set(
    item.sections.flatMap((s) => (s.heading ? [s.heading] : [])),
  );
  // Stored boundaries the item no longer has (the publisher renamed a section): when
  // none match, segmentation is back on the 2-8 minute rules.
  const stale = (item.boundaries ?? []).filter((h) => !headings.has(h));
  const applied = (item.boundaries ?? []).length > stale.length;
  const momentHeadings = new Set(
    item.moments.flatMap((m) => (m.heading ? [m.heading] : [])),
  );
  // Corrections for headings that don't start a moment now: shown so they can be
  // cleared, since they come back if the heading starts a moment again.
  const orphans = [...item.tagOverrides].filter(
    ([heading]) => heading !== "" && !momentHeadings.has(heading),
  );
  return (
    <main className={ADMIN_MAIN}>
      <div>
        <h1 className="text-title">{item.title}</h1>
        <p className="text-sm text-ink-muted">
          {item.sourceName} ·{" "}
          <a href={item.url} className="text-select">
            {item.url}
          </a>
        </p>
      </div>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {isSaveError(error) ? (
        <Card className="px-4 py-3 text-sm text-wrong">
          <div role="alert">
            <p>{ERRORS[error]}</p>
            {list(detail).length > 0 ? (
              <ul>
                {list(detail).map((value) => (
                  <li key={value}>
                    <code>{value}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
      ) : null}
      <datalist id="concepts">
        {concepts.map((slug) => (
          <option key={slug} value={slug} />
        ))}
      </datalist>

      <section>
        <h2 className="mb-2 text-section">Moments</h2>
        <ol
          start={0}
          className="divide-y divide-hairline border-y border-hairline text-sm tabular-nums"
        >
          {item.moments.map((moment) => (
            <li key={moment.ordinal} className="py-3">
              {moment.title} · {moment.estimatedMinutes} min
              {moment.oversized ? " · oversized" : ""}
              {moment.heading !== null ? (
                <TagForm
                  itemId={item.id}
                  heading={moment.heading}
                  model={item.modelTags.moments.get(moment.ordinal)}
                  override={item.tagOverrides.get(moment.heading)}
                />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-section">Item tags</h2>
        <TagForm
          itemId={item.id}
          heading=""
          model={item.modelTags.item}
          override={item.tagOverrides.get("")}
        />
      </section>

      {orphans.length > 0 ? (
        <section>
          <h2 className="mb-2 text-section">
            Corrections for headings that no longer start a moment
          </h2>
          <ul className="divide-y divide-hairline border-y border-hairline text-sm">
            {orphans.map(([heading, tags]) => (
              <li
                key={heading}
                className="flex items-center justify-between gap-3 py-3"
              >
                {heading}: {describe(tags)}
                <form action={saveTagsAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="heading" value={heading} />
                  <button
                    type="submit"
                    name="intent"
                    value="clear"
                    className={SECONDARY}
                  >
                    Clear override
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-section">Section boundaries</h2>
        <p className="text-ink-muted">
          {applied
            ? "Moments start at the ticked headings."
            : "Moments follow the 2-8 minute rules. Tick headings to choose the starts yourself."}
        </p>
        {stale.length > 0 ? (
          <p>
            Saved boundaries this item no longer has:{" "}
            {stale.map((h) => (
              <code key={h}>{h} </code>
            ))}
          </p>
        ) : null}
        <form action={saveBoundariesAction} className="flex flex-col gap-3">
          <input type="hidden" name="itemId" value={item.id} />
          <ul className="divide-y divide-hairline border-y border-hairline tabular-nums">
            {item.sections.map((section, index) =>
              section.heading === null ? (
                <li key={index} className="py-2 text-ink-muted">
                  Intro · {section.wordCount} words
                </li>
              ) : (
                <li key={index} className="py-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="boundary"
                      value={section.heading}
                      defaultChecked={boundaries.has(section.heading)}
                    />{" "}
                    {"  ".repeat(Math.max(0, (section.level ?? 2) - 2))}
                    {section.heading} · {section.wordCount} words
                  </label>
                </li>
              ),
            )}
          </ul>
          <button type="submit" className={`${ACT} self-start`}>
            Save boundaries and re-segment
          </button>
        </form>
      </section>
    </main>
  );
}
