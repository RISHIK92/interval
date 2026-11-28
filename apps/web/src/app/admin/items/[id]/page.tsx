import { notFound } from "next/navigation";
import { adminReview } from "../../../../server/container";
import type { SaveError } from "../../../../server/admin-review";
import type { ReviewTags } from "../../../../server/ports";
import { Card } from "../../../ui/Card";
import { FIELD } from "../../../ui/field";
import { requireAdmin } from "../../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../../style";
import { saveTagsAction } from "./actions";

export const dynamic = "force-dynamic";

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

// Fixed text per code (server/admin-review.ts): the query string chooses which, never
// what it says.
const ERRORS: Record<SaveError, string> = {
  "no-item": "That item no longer exists.",
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
  model: ReviewTags | null;
  override: ReviewTags | null;
}) {
  const current = props.override ?? props.model;
  return (
    <form
      action={saveTagsAction}
      className="mt-2 flex flex-wrap items-end gap-3 text-sm"
    >
      <input type="hidden" name="itemId" value={props.itemId} />
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

// ING-6, P1-W3-S05: review one item's tags; its sections are listed for reference.
// Corrections are overrides, kept apart from the model's output and surviving
// re-ingestion. ADR-0058: the whole article only; moments and their boundaries went.
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
        <h2 className="text-section">Item tags</h2>
        <TagForm
          itemId={item.id}
          model={item.modelTags}
          override={item.tagOverride}
        />
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <h2 className="text-section">Sections</h2>
        <ul className="divide-y divide-hairline border-y border-hairline tabular-nums">
          {item.sections.map((section, index) => (
            <li
              key={index}
              className={
                section.heading === null ? "py-2 text-ink-muted" : "py-2"
              }
            >
              {section.heading === null
                ? "Intro"
                : `${"  ".repeat(Math.max(0, (section.level ?? 2) - 2))}${section.heading}`}{" "}
              · {section.wordCount} words
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
