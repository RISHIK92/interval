import Link from "next/link";
import { adminReview } from "../../../server/container";
import type { ReasonKind } from "../../../server/ports";
import { requireAdmin } from "../guard";
import { ADMIN_MAIN, TABLE } from "../style";

export const dynamic = "force-dynamic";

const LIMIT = 100;

const REASON_NAMES: Record<ReasonKind, string> = {
  explore: "something new",
  topic_match: "topic",
  goal_match: "goal",
  project_match: "project",
  level_fit: "level",
  time_fit: "length",
  quality: "trusted source",
  freshness: "new this week",
};

// ING-6: the items most recently fetched, to pick one to review; items users reported
// a "Shown for" reason on first (ADR-0026), to fix their tags or the seed mapping.
export default async function ReviewListPage() {
  await requireAdmin();
  const items = await adminReview().recent(LIMIT);
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Review items</h1>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">No items yet.</p>
      ) : (
        <table className={TABLE}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Source</th>
              <th>Moments</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link
                    href={`/admin/items/${item.id}`}
                    className="font-semibold text-select"
                  >
                    {item.title}
                  </Link>
                </td>
                <td className="text-ink-muted">{item.sourceName}</td>
                <td>{item.momentCount} moments</td>
                <td className="text-sm">
                  {item.reports
                    .map((r) => `${REASON_NAMES[r.reason]} ×${String(r.count)}`)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
