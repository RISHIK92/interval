import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { library, preferences, sessionReader } from "../../server/container";
import { outHref } from "../../server/outbound";
import { TabNav } from "../TabNav";
import { libraryUnsaveAction } from "./actions";

export const dynamic = "force-dynamic";

const LIMIT = 50;

// The Library tab (§4.1, §5I, C-06, Q-P1-19, P1-W5-S05): what you saved and what you
// finished (owner: finished, not opened). Everything, hidden sources included: it is
// the reader's own record, not the feed.
export default async function LibraryPage() {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  if ((await preferences().get(actor.userId)) === null) redirect("/onboarding");
  const [saved, finished] = await Promise.all([
    library().saves(actor.userId, LIMIT),
    library().history(actor.userId, LIMIT),
  ]);
  const open = (itemId: string) =>
    outHref({ itemId, from: "library", target: "original" });
  return (
    <main>
      <h1>Library</h1>
      <p>
        <Link href="/profile">Profile</Link>
      </p>
      <TabNav current="library" />

      <section aria-label="Saved">
        <h2>Saved</h2>
        {saved.length === 0 ? (
          <p>Nothing saved yet.</p>
        ) : (
          <ul>
            {saved.map((item) => (
              <li key={item.itemId}>
                <p>{`${item.articleTitle} · ${item.sourceName}`}</p>
                <a
                  href={open(item.itemId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${item.articleTitle} on the original website`}
                >
                  Open original website
                </a>
                <form action={libraryUnsaveAction}>
                  <input type="hidden" name="itemId" value={item.itemId} />
                  <button
                    type="submit"
                    aria-label={`Unsave ${item.articleTitle}`}
                  >
                    Unsave
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Finished">
        <h2>Finished</h2>
        {finished.length === 0 ? (
          <p>Nothing finished yet.</p>
        ) : (
          <ul>
            {finished.map((item) => (
              <li key={item.itemId}>
                <p>{`${item.articleTitle} · ${item.sourceName}`}</p>
                <p>
                  {item.finished
                    ? "Finished"
                    : `${String(item.finishedSections)} of ${String(item.totalSections)} sections`}
                </p>
                <a
                  href={open(item.itemId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${item.articleTitle} on the original website`}
                >
                  Open original website
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
