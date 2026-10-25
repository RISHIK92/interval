import { adminSources } from "../../../server/container";
import { requireAdmin } from "../guard";
import { switchMomentsAction } from "./actions";

export const dynamic = "force-dynamic";

// §3.2, P1-W3-S06: switch a source's moments off; they leave the feed at once. The
// seed file owns everything else, including turning a source off (ADR-0006 C-28).
export default async function SourcesPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const sources = await adminSources().list();
  return (
    <main>
      <h1>Sources</h1>
      {saved ? <p role="status">Saved.</p> : null}
      {error === "no-source" ? (
        <p role="alert">That source no longer exists.</p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Rights</th>
            <th>Moments</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.id}>
              <td>
                {source.name}
                {source.active ? "" : " (not in the seed file)"}
              </td>
              <td>{source.rightsProfile}</td>
              <td>
                {source.momentsEnabled
                  ? "on"
                  : source.momentsSwitchedOff
                    ? "switched off here"
                    : "off in the seed file"}
              </td>
              <td>
                {source.momentsSeeded && source.active ? (
                  <form action={switchMomentsAction}>
                    <input type="hidden" name="sourceId" value={source.id} />
                    <button
                      type="submit"
                      name="switch"
                      value={source.momentsSwitchedOff ? "on" : "off"}
                    >
                      {source.momentsSwitchedOff
                        ? "Switch moments back on"
                        : "Switch moments off"}
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
