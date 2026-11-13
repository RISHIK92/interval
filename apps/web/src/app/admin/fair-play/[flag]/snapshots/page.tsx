import { notFound } from "next/navigation";
import { z } from "zod";
import { battleSnapshots, files } from "../../../../../server/container";
import { log } from "../../../../../server/log";
import { BIGINT_ID } from "../../../../../server/ports";
import { Card } from "../../../../ui/Card";
import { requireAdmin } from "../../../guard";
import { ADMIN_MAIN } from "../../../style";

export const dynamic = "force-dynamic";

// As the snapshot route stored it.
const Stored = z.object({ language: z.string(), code: z.string() });

async function codeAt(key: string): Promise<string | null> {
  const file = await files().get(key);
  if (file === null || file === "unchanged") return null;
  const text = await new Response(file.body).text();
  try {
    return Stored.parse(JSON.parse(text)).code;
  } catch (error) {
    // Shown as missing; the others are still shown.
    log.error("battle: snapshot unreadable", { key, error });
    return null;
  }
}

// P5-W31-S04b (§6.9, Q-P5-17): a flagged battle player's code every 30 s, so a review
// can see how it was written: typed up over time, or arriving whole.
export default async function SnapshotsPage(props: {
  params: Promise<{ flag: string }>;
}) {
  await requireAdmin();
  const { flag } = await props.params;
  if (!BIGINT_ID.test(flag)) notFound();
  const listed = await battleSnapshots().forFlag(flag);
  if (listed === null) notFound();
  const codes = await Promise.all(listed.snapshots.map((s) => codeAt(s.key)));
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">{listed.player}&apos;s code, every 30 s</h1>
      {listed.snapshots.length === 0 ? (
        <p className="text-ink-muted">No snapshots.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {listed.snapshots.map((s, i) => (
            <li key={s.key}>
              <Card className="flex flex-col gap-2 p-4 text-sm">
                <p className="text-ink-muted">
                  {s.takenAt.toISOString().slice(11, 19)} UTC · {s.language}
                </p>
                {codes[i] == null ? (
                  <p className="text-wrong">The stored code is missing.</p>
                ) : (
                  <pre className="overflow-x-auto font-mono text-xs">
                    {codes[i]}
                  </pre>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
