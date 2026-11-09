import { adminTts } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN } from "../style";
import { pickVoiceAction } from "./actions";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  inworld: "Inworld",
  polly: "Amazon Polly",
};

// P4-W22-S03 (TTS-1, Q-P4-07): the blind test. The same five scripts said by each
// provider (`tts-blind-test`), as voices A, B, C in an order shuffled per script; the
// owner picks one for each. Which provider each voice was shows only once all five have
// a pick (owner, 2026-11-09). Choosing the provider (TTS_PROVIDER) is the owner's step.
export default async function TtsPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const run = await adminTts().latest();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Voice blind test</h1>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error === "picked" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            That script has a pick already.
          </p>
        </Card>
      ) : null}
      {run?.newerStopped === true ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            The latest test stopped part way (the budget, or a provider
            failing), so the one before is shown. Run tts-blind-test again.
          </p>
        </Card>
      ) : null}
      {run === null ? (
        <p className="text-ink-muted">
          No test yet: add two providers&apos; keys to the worker and run
          tts-blind-test.
        </p>
      ) : (
        <>
          {run.scripts.map((script) => {
            const done = script.voices.some((v) => v.picked);
            return (
              <Card key={script.scriptNo} className="flex flex-col gap-3 p-5">
                <h2 className="text-section">Script {script.scriptNo}</h2>
                <ul className="flex flex-col gap-3">
                  {script.voices.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <span className="font-semibold">
                        Voice {v.label}
                        {v.provider === null
                          ? ""
                          : ` · ${NAMES[v.provider] ?? v.provider}`}
                        {v.picked ? " · your pick" : ""}
                      </span>
                      <audio
                        controls
                        preload="none"
                        src={`/api/admin/tts/${v.id}`}
                        aria-label={`Script ${String(script.scriptNo)}, voice ${v.label}`}
                      />
                      {done ? null : (
                        <form action={pickVoiceAction}>
                          <input type="hidden" name="sampleId" value={v.id} />
                          <button type="submit" className={ACT}>
                            Pick {v.label}
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {run.revealed ? (
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="text-section">Picks by provider</h2>
              <ul>
                {run.tally.map((t) => (
                  <li key={t.provider}>
                    {NAMES[t.provider] ?? t.provider}: {t.picks}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-muted">
                Set TTS_PROVIDER in the worker&apos;s settings to the one you
                choose.
              </p>
            </Card>
          ) : (
            <p className="text-sm text-ink-muted">
              The providers show once every script has a pick.
            </p>
          )}
        </>
      )}
    </main>
  );
}
