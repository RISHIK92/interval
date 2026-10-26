import Link from "next/link";
import { adminReview } from "../../../server/container";
import { requireAdmin } from "../guard";
import { ADMIN_MAIN, TABLE } from "../style";

export const dynamic = "force-dynamic";

const LIMIT = 100;

// ING-6: the items most recently fetched, to pick one to review.
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
