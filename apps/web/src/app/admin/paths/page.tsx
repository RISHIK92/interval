import { adminPaths } from "../../../server/container";
import type { PathStatus, ReviewPath } from "../../../server/ports";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { pathAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<PathStatus, string> = {
  draft: "Draft",
  live: "Live",
  retired: "Retired",
};
const FIELD = "rounded-xl border border-hairline bg-page px-3 py-1.5 text-sm";

// §5F, Q-P2-23, Q-P2-24 (P2-W10-S02): the model's proposed paths, for the owner to
// reorder, trim and approve (launch 5 to 8) or retire. Only drafts are edited; a live
// path can only be retired. Names and whys are the model's words, shown as text.
export default async function PathsPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const paths = await adminPaths().list();
  const live = paths.filter((p) => p.status === "live").length;
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Topic paths</h1>
      <p className="text-sm text-ink-muted">{live} live (launch 5–8)</p>
      {saved ? (
        <p role="status" className="text-sm">
          Saved.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-wrong">
          That change didn&apos;t apply: a live path isn&apos;t edited, and a
          path needs 2 sections, each with a reading its rights allow, to go
          live.
        </p>
      ) : null}
      {paths.length === 0 ? (
        <p className="text-ink-muted">
          No paths yet. Run <code>propose-paths</code> to get proposals.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {paths.map((p) => (
            <li key={p.pathId}>
              <PathCard path={p} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function PathCard({ path }: { path: ReviewPath }) {
  const draft = path.status === "draft";
  return (
    <Card className="flex flex-col gap-4 p-5 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-muted">
            {STATUS[path.status]}
          </p>
          <h2 className="text-base font-semibold">{path.name}</h2>
          <p className="text-ink-muted">{path.why}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {draft ? (
            <Control
              pathId={path.pathId}
              control="approve"
              label="Approve"
              name={`Approve ${path.name}`}
              act
            />
          ) : null}
          {path.status !== "retired" ? (
            <Control
              pathId={path.pathId}
              control="retire"
              label="Retire"
              name={`Retire ${path.name}`}
            />
          ) : null}
        </div>
      </div>
      {draft ? (
        <form action={pathAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="control" value="rename" />
          <input type="hidden" name="pathId" value={path.pathId} />
          <label className="flex flex-col gap-1">
            Name
            <input
              name="name"
              defaultValue={path.name}
              maxLength={120}
              required
              className={FIELD}
            />
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1">
            Why
            <input
              name="why"
              defaultValue={path.why}
              maxLength={500}
              required
              className={FIELD}
            />
          </label>
          <button type="submit" className={SECONDARY}>
            Save name
          </button>
        </form>
      ) : null}
      <ol className="flex flex-col gap-3">
        {path.sections.map((section, i) => (
          <li
            key={section.sectionId}
            className="rounded-xl border border-hairline p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">
                {i + 1}. {section.concepts.join(", ")}
              </p>
              {draft ? (
                <div className="flex gap-2">
                  {/* No Up on the first section, no Down on the last. */}
                  {i > 0 ? (
                    <Control
                      sectionId={section.sectionId}
                      control="up"
                      label="↑ Up"
                      name={`Move section ${String(i + 1)} up`}
                    />
                  ) : null}
                  {i < path.sections.length - 1 ? (
                    <Control
                      sectionId={section.sectionId}
                      control="down"
                      label="↓ Down"
                      name={`Move section ${String(i + 1)} down`}
                    />
                  ) : null}
                  <Control
                    sectionId={section.sectionId}
                    control="remove-section"
                    label="Remove section"
                    name={`Remove section ${String(i + 1)}`}
                  />
                </div>
              ) : null}
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {section.sessions.map((s) => (
                <li
                  key={s.ordinal}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0">
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {s.sectionTitle}
                    </a>{" "}
                    <span className="text-ink-muted">
                      · {s.articleTitle} · {s.sourceName}
                    </span>
                    {s.allowed ? null : (
                      <span className="ml-2 font-semibold text-wrong">
                        Rights changed
                      </span>
                    )}
                  </span>
                  {draft ? (
                    <form action={pathAction}>
                      <input
                        type="hidden"
                        name="control"
                        value="remove-session"
                      />
                      <input
                        type="hidden"
                        name="sectionId"
                        value={section.sectionId}
                      />
                      <input type="hidden" name="ordinal" value={s.ordinal} />
                      <button
                        type="submit"
                        className={SECONDARY}
                        aria-label={`Remove reading ${s.sectionTitle}`}
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Control(props: {
  control: "approve" | "retire" | "up" | "down" | "remove-section";
  label: string;
  // What a screen reader hears: the action and what it acts on.
  name: string;
  pathId?: string;
  sectionId?: string;
  act?: boolean;
}) {
  return (
    <form action={pathAction}>
      {props.pathId === undefined ? null : (
        <input type="hidden" name="pathId" value={props.pathId} />
      )}
      {props.sectionId === undefined ? null : (
        <input type="hidden" name="sectionId" value={props.sectionId} />
      )}
      <button
        type="submit"
        name="control"
        value={props.control}
        aria-label={props.name}
        className={props.act === true ? ACT : SECONDARY}
      >
        {props.label}
      </button>
    </form>
  );
}
