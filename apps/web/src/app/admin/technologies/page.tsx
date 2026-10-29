import { adminTechnologies } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY, TABLE } from "../style";
import { decideTechnologyAction } from "./actions";

export const dynamic = "force-dynamic";

// PER-4, §5H, P2-W12-S03: the curated technology table's additions. The seed file is
// the owner's (workers/jobs/seeds/technologies.yaml); for packages it doesn't claim,
// a model suggests a technology and its concepts, labeled as AI until decided (AI-3).
// What an acceptance adds lives in the database; a seed reload leaves it alone.
export default async function TechnologiesPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const [pending, unclaimed, coverage] = await Promise.all([
    adminTechnologies().pending(),
    adminTechnologies().unclaimed(30),
    adminTechnologies().coverage(),
  ]);
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Technologies</h1>
      <p className="text-sm text-ink-muted">
        {coverage.technologies} technologies, {coverage.packages} package
        patterns. {coverage.resolved} of {coverage.dependencies} dependency
        names resolve.
      </p>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error === "conflict" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            Not accepted: its slug is a retired technology, or the package is
            claimed already. Reject it, or add it to the seed file.
          </p>
        </Card>
      ) : null}
      {error === "decided" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            That suggestion was already decided.
          </p>
        </Card>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Suggestions</h2>
        {pending.length === 0 ? (
          <p className="text-ink-muted">Nothing to review.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-2 p-5 text-sm">
                  <p className="text-ink-muted">
                    {s.ecosystem} · <code>{s.package}</code> · {s.users}{" "}
                    {s.users === 1 ? "user" : "users"}
                  </p>
                  <p className="rounded-xl border border-dashed border-hairline px-3 py-2">
                    <span className="text-xs text-ink-muted">
                      AI suggestion · {s.model}
                    </span>
                    <br />
                    <span className="font-semibold">{s.name}</span> (
                    <code>{s.slug}</code>):{" "}
                    {s.concepts.map((c) => c.name).join(", ")}
                  </p>
                  <form action={decideTechnologyAction} className="flex gap-2">
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <button
                      type="submit"
                      name="decision"
                      value="accept"
                      className={ACT}
                    >
                      Accept
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="reject"
                      className={SECONDARY}
                    >
                      Reject
                    </button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Unclaimed packages</h2>
        {unclaimed.length === 0 ? (
          <p className="text-ink-muted">Every stored dependency resolves.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th>Ecosystem</th>
                <th>Package</th>
                <th>Users</th>
              </tr>
            </thead>
            <tbody>
              {unclaimed.map((u) => (
                <tr key={`${u.ecosystem}:${u.package}`}>
                  <td>{u.ecosystem}</td>
                  <td>
                    <code>{u.package}</code>
                  </td>
                  <td>{u.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
