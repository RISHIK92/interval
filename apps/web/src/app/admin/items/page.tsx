import Link from "next/link";
import { adminReview } from "../../../server/container";
import { requireAdmin } from "../guard";

export const dynamic = "force-dynamic";

const LIMIT = 100;

// ING-6: the items most recently fetched, to pick one to review.
export default async function ReviewListPage() {
  await requireAdmin();
  const items = await adminReview().recent(LIMIT);
  return (
    <main>
      <h1>Review items</h1>
      {items.length === 0 ? (
        <p>No items yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/admin/items/${item.id}`}>{item.title}</Link> ·{" "}
              {item.sourceName} · {item.momentCount} moments
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
