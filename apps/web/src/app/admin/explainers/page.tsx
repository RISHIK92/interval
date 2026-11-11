import {
  adminExplainers,
  adminScenes,
  mediaFiles,
} from "../../../server/container";
import { AiDrafted } from "../../ui/AiDrafted";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { decideExplainerAction, decideSceneAction } from "./actions";
import { loadTimeline } from "./scene";
import { SceneReview } from "./SceneReview";

export const dynamic = "force-dynamic";

// P4-W22-S01 (§5G, AI-1, AI-3, Q-P4-11, ADR-0038): concept explainer scripts, written by
// EXPLAINER_MODEL from full-text sources (`write-explainers`), each approved or rejected
// here before it is voiced. The script is the model's, so labeled; its citations are the
// sections it quotes, linked to the publisher's page (§3.2), never their text. Below
// them, P4.5-W26-S02 (Q-P4.5-03): drafted scene timelines, drawn and stepped through,
// approved only when they keep every rule.
export default async function ExplainersPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const pending = await adminExplainers().pending();
  const scenes = await adminScenes().pending();
  // P4.5-W26-S02: the bucket is read only when a timeline waits, so nothing else here
  // needs it.
  const loaded = await Promise.all(
    scenes.map(async (s) => ({
      ...s,
      loaded: await loadTimeline(mediaFiles(), s.key, s.captions.length),
    })),
  );
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Explainers</h1>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error === "decided" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            Not saved: that script was already decided, or no longer has two
            sources to cite.
          </p>
        </Card>
      ) : null}
      {error === "scene" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            Not approved: that timeline breaks a rule. Its problems are listed
            below.
          </p>
        </Card>
      ) : null}
      {pending.length === 0 ? (
        <p className="text-ink-muted">Nothing to review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((x) => (
            <li key={x.id}>
              <Card className="flex flex-col gap-3 p-5 text-sm">
                <div className="flex items-center gap-2">
                  <h2 className="text-section">{x.concept}</h2>
                  <AiDrafted />
                </div>
                <p className="whitespace-pre-line">{x.script}</p>
                <div>
                  <h3 className="font-semibold">Sources</h3>
                  <ul className="list-disc pl-5">
                    {x.citations.map((c) => (
                      <li key={c.momentId}>
                        <a
                          href={c.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          {c.articleTitle}: {c.sectionTitle}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                {x.missing === 0 ? null : (
                  <p className="text-wrong">
                    {x.missing === 1
                      ? "1 cited section is"
                      : `${String(x.missing)} cited sections are`}{" "}
                    gone since it was written.
                  </p>
                )}
                <p className="text-ink-muted">Written by {x.model}</p>
                <form action={decideExplainerAction} className="flex gap-2">
                  <input type="hidden" name="explainerId" value={x.id} />
                  {/* AI-1: never approved without its sources. */}
                  {x.citations.length < 2 ? null : (
                    <button
                      type="submit"
                      name="decision"
                      value="approved"
                      className={ACT}
                    >
                      Approve
                    </button>
                  )}
                  <button
                    type="submit"
                    name="decision"
                    value="rejected"
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
      <h2 className="text-title">Timelines</h2>
      {loaded.length === 0 ? (
        <p className="text-ink-muted">No timelines to review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {loaded.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-col gap-3 p-5 text-sm">
                <div className="flex items-center gap-2">
                  <h3 className="text-section">{s.concept}</h3>
                  <AiDrafted />
                </div>
                {"timeline" in s.loaded ? (
                  <SceneReview
                    timeline={s.loaded.timeline}
                    captions={s.captions}
                  />
                ) : (
                  <div className="text-wrong">
                    <h4 className="font-semibold">Problems</h4>
                    <ul className="list-disc pl-5">
                      {s.loaded.problems.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-ink-muted">Drawn by {s.model}</p>
                <form action={decideSceneAction} className="flex gap-2">
                  <input type="hidden" name="sceneId" value={s.id} />
                  {/* AI-1: only a timeline that keeps every rule. */}
                  {"timeline" in s.loaded ? (
                    <button
                      type="submit"
                      name="decision"
                      value="approved"
                      className={ACT}
                    >
                      Approve
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    name="decision"
                    value="rejected"
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
    </main>
  );
}
