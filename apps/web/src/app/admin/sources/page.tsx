import { adminSources } from "../../../server/container";
import { requireAdmin } from "../guard";
import { ADMIN_MAIN, TABLE } from "../style";

export const dynamic = "force-dynamic";

// The sources and their rights profiles, as the seed file set them; the seed file owns
// every setting, including turning a source off (ADR-0006 C-28). ADR-0058 removed the
// moments switch this page had (P1-W3-S06).
export default async function SourcesPage() {
  await requireAdmin();
  const sources = await adminSources().list();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Sources</h1>
      <table className={TABLE}>
        <thead>
          <tr>
            <th>Source</th>
            <th>Rights</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.id}>
              <td>
                <span className="font-semibold">{source.name}</span>
                {source.active ? "" : " (not in the seed file)"}
              </td>
              <td>{source.rightsProfile}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
