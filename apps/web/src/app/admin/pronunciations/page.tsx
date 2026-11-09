import { adminPronunciations } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY, TABLE } from "../style";
import { addPronunciationAction, removePronunciationAction } from "./actions";

export const dynamic = "force-dynamic";

// P4-W22-S02 (TTS-2, Q-P4-10): how technical terms are said in voiced explainers. The
// seed's terms come from workers/jobs/seeds/pronunciations.yaml (`load-pronunciations`)
// and change there; terms added here live in the database, and a reload leaves them.
export default async function PronunciationsPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const terms = await adminPronunciations().list();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Pronunciations</h1>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error === "taken" || error === "invalid" || error === "kept" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            {error === "taken"
              ? "That term is in the dictionary already."
              : error === "kept"
                ? "Not removed: it's the seed file's (change it there), or gone already."
                : "A term needs 1 to 80 characters, and how to say it 1 to 200."}
          </p>
        </Card>
      ) : null}
      <Card className="p-5">
        <form action={addPronunciationAction} className="flex flex-wrap gap-2">
          <label className="flex flex-col text-sm">
            Term
            <input
              name="term"
              required
              maxLength={80}
              className="rounded border border-hairline px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-sm">
            Say it as
            <input
              name="say"
              required
              maxLength={200}
              className="rounded border border-hairline px-2 py-1"
            />
          </label>
          <button type="submit" className={ACT}>
            Add
          </button>
        </form>
      </Card>
      {terms.length === 0 ? (
        <p className="text-ink-muted">No terms yet: run load-pronunciations.</p>
      ) : (
        <table className={TABLE}>
          <thead>
            <tr>
              <th>Term</th>
              <th>Say it as</th>
              <th>From</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id}>
                <td>{t.term}</td>
                <td>{t.say}</td>
                <td>{t.origin === "seed" ? "Seed file" : "Added here"}</td>
                <td>
                  {t.origin === "admin" ? (
                    <form action={removePronunciationAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className={SECONDARY}>
                        Remove
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
