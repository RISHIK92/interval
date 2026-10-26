import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { library, preferences, sessionReader } from "../../server/container";
import { outHref } from "../../server/outbound";
import { TabBar } from "../TabBar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { libraryUnsaveAction } from "./actions";

export const dynamic = "force-dynamic";

const LIMIT = 50;

// The Library tab (§4.1, §5I, C-06, Q-P1-19, P1-W5-S05): what you saved and what you
// finished (owner: finished, not opened). Everything, hidden sources included: it is
// the reader's own record, not the feed.
// The publisher's page, unless the weekly check found it gone (P1-W6-S03): the item
// stays listed so the reader knows why it left the feed (owner, 2026-10-26).
function OriginalLink(props: {
  item: { itemId: string; articleTitle: string; linkBroken: boolean };
}) {
  const { item } = props;
  if (item.linkBroken)
    return <p className="text-sm text-ink-muted">Link broken</p>;
  return (
    <a
      href={outHref({
        itemId: item.itemId,
        from: "library",
        target: "original",
      })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${item.articleTitle} on the original website`}
      className="text-sm font-semibold text-select"
    >
      Open original website
    </a>
  );
}

const icon = (path: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

// Highlights, notes and audio come with later phases (owner, 2026-10-26): shown, dimmed,
// so the shelf has its final shape.
const LATER = [
  { label: "Highlights", icon: icon(<path d="M4 20h6M14 4l6 6-9 9H5v-6z" />) },
  {
    label: "Notes",
    icon: icon(<path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5" />),
  },
  {
    label: "Audio",
    icon: icon(
      <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3z" />,
    ),
  },
];

const TILE = "flex flex-col gap-2 rounded-2xl bg-well p-4";

function Row(props: { title: string; source: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <p>
        <span className="font-semibold">{props.title}</span>
        <span className="text-ink-muted">{` · ${props.source}`}</span>
      </p>
      {props.children}
    </li>
  );
}

// No bar for a one-section article, as on Home (owner, 2026-10-26).
function Progress(props: { done: number; total: number }) {
  if (props.total <= 1) return null;
  return (
    <div aria-hidden="true" className="flex gap-1">
      {Array.from({ length: props.total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i < props.done ? "bg-go" : "bg-track"}`}
        />
      ))}
    </div>
  );
}

export default async function LibraryPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if ((await preferences().get(actor.userId)) === null) redirect("/onboarding");
  const [saved, finished] = await Promise.all([
    library().saves(actor.userId, LIMIT),
    library().history(actor.userId, LIMIT),
  ]);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <h1 className="text-display">Library</h1>
        <Link href="/profile" className="text-sm font-semibold text-ink-muted">
          Profile
        </Link>
      </div>
      <TabBar current="library" />

      <section aria-label="Everything you kept">
        <h2 className="mb-3 text-section">Everything you kept</h2>
        <div className="grid grid-cols-2 gap-3">
          <div role="group" aria-label="Saved" className={TILE}>
            {icon(<path d="M6 3h12v18l-6-4-6 4z" />)}
            <span className="font-semibold">Saved</span>
            {/* Only the newest LIMIT are read, so a full page is "at least". */}
            <span className="text-numbers">
              {saved.length === LIMIT ? `${String(LIMIT)}+` : saved.length}
            </span>
          </div>
          {LATER.map((tile) => (
            <div
              key={tile.label}
              role="group"
              aria-label={tile.label}
              aria-disabled="true"
              className={`${TILE} opacity-50`}
            >
              {tile.icon}
              <span className="font-semibold">{tile.label}</span>
              <span className="text-sm text-ink-muted">Coming later</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Saved">
        <h2 className="mb-3 text-section">Saved</h2>
        <Card>
          {saved.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Nothing saved yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {saved.map((item) => (
                <Row
                  key={item.itemId}
                  title={item.articleTitle}
                  source={item.sourceName}
                >
                  <div className="flex items-center justify-between gap-3">
                    <OriginalLink item={item} />
                    <form action={libraryUnsaveAction}>
                      <input type="hidden" name="itemId" value={item.itemId} />
                      <Button
                        type="submit"
                        variant="secondary"
                        className="px-4 py-1.5 text-sm"
                        aria-label={`Unsave ${item.articleTitle}`}
                      >
                        Unsave
                      </Button>
                    </form>
                  </div>
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-label="Finished">
        <h2 className="mb-3 text-section">Finished</h2>
        <Card>
          {finished.length === 0 ? (
            <p className="px-5 py-4 text-ink-muted">Nothing finished yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {finished.map((item) => (
                <Row
                  key={item.itemId}
                  title={item.articleTitle}
                  source={item.sourceName}
                >
                  <p
                    className={`text-sm ${item.finished ? "text-go-text" : "text-ink-muted"}`}
                  >
                    {item.finished
                      ? "Finished"
                      : `${String(item.finishedSections)} of ${String(item.totalSections)} sections`}
                  </p>
                  <Progress
                    done={
                      item.finished ? item.totalSections : item.finishedSections
                    }
                    total={item.totalSections}
                  />
                  <OriginalLink item={item} />
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </main>
  );
}
