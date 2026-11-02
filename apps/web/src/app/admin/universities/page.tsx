import {
  adminUniversities,
  playerUniversities,
} from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY, TABLE } from "../style";
import { tidyUniversityAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  taken: "Another university has that name: merge into it instead.",
  name: "A name is 2 to 120 letters, without hidden characters.",
  merge: "Not merged: check the id to merge into (not itself).",
  missing: "That typed university is gone already.",
};

const INPUT =
  "w-48 rounded-xl border border-hairline bg-page px-2 py-1.5 text-sm";

// P3-W14-S03 (ADR-0032; owner, 2026-11-02): names players typed show on boards at
// once; here the owner renames them, merges them into a listed one, or removes them.
// Listed universities come from workers/jobs/seeds/universities.json.
export default async function UniversitiesPage(props: {
  searchParams: Promise<{ saved?: string; error?: string; q?: string }>;
}) {
  await requireAdmin();
  const { saved, error, q } = await props.searchParams;
  const query = (q ?? "").trim();
  const [rows, matches] = await Promise.all([
    adminUniversities().typed(),
    query.length >= 2
      ? playerUniversities().search(query, 50)
      : Promise.resolve(null),
  ]);
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Universities</h1>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error !== undefined && Object.hasOwn(ERRORS, error) ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            {ERRORS[error]}
          </p>
        </Card>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Typed by players</h2>
        {rows.length === 0 ? (
          <p className="text-ink-muted">No typed universities.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th>Id</th>
                <th>Name</th>
                <th>Players</th>
                <th>Rename</th>
                <th>Merge into id</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.name}</td>
                  <td>{row.members}</td>
                  <td>
                    <form action={tidyUniversityAction} className="flex gap-2">
                      <input type="hidden" name="universityId" value={row.id} />
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={120}
                        defaultValue={row.name}
                        aria-label={`New name for ${row.name}`}
                        className={INPUT}
                      />
                      <button
                        type="submit"
                        name="op"
                        value="rename"
                        className={SECONDARY}
                      >
                        Rename
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={tidyUniversityAction} className="flex gap-2">
                      <input type="hidden" name="universityId" value={row.id} />
                      <input
                        name="intoId"
                        required
                        inputMode="numeric"
                        aria-label={`Id to merge ${row.name} into`}
                        className={INPUT}
                      />
                      <button
                        type="submit"
                        name="op"
                        value="merge"
                        className={ACT}
                      >
                        Merge
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={tidyUniversityAction}>
                      <input type="hidden" name="universityId" value={row.id} />
                      <button
                        type="submit"
                        name="op"
                        value="remove"
                        className={SECONDARY}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Find an id</h2>
        <form
          action="/admin/universities"
          method="get"
          role="search"
          className="flex gap-2"
        >
          <input
            name="q"
            type="search"
            defaultValue={query}
            minLength={2}
            aria-label="University name"
            className={INPUT}
          />
          <button type="submit" className={SECONDARY}>
            Search
          </button>
        </form>
        {matches === null ? null : matches.length === 0 ? (
          <p className="text-ink-muted">No university matches.</p>
        ) : (
          <table className={TABLE}>
            <thead>
              <tr>
                <th>Id</th>
                <th>Name</th>
                <th>Country</th>
                <th>Listed</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.name}</td>
                  <td>{u.country ?? "—"}</td>
                  <td>{u.listed ? "yes" : "typed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
