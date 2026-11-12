"use client";

import {
  BATTLE,
  type BattleState,
  battleSent,
  runLive,
} from "@interval/game-client";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { openMatch } from "../../live/join";
import { CodeEditor, type CodeEditorProps } from "./CodeEditor";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16; LLDQ-4): a battle's screen. The player writes in
// their language, Runs the visible tests or Submits for points, and sees the clock, the
// opponent's best, and the extension when the game server reveals it. Each language's
// code is kept in this tab's session storage, so a reload keeps the work.

const LANGUAGE_NAMES: Record<string, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  java: "Java",
  cpp: "C++",
  go: "Go",
};
const LAYER_NAMES: Record<string, string> = {
  visible: "Visible",
  hidden: "Hidden",
  concurrency: "Concurrency",
  extension: "Extension",
};

type Props = {
  matchId: string;
  statement: string;
  examples: string[];
  starters: Record<string, string>;
  // Tests swap Monaco for a plain field.
  Editor?: ComponentType<CodeEditorProps>;
  now?: () => number;
};

function stored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null; // storage off (a private window): the starter, then
  }
}

function store(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage off: the code lives as long as the page.
  }
}

// A battle's code in one language: this tab's saved copy, or the starter. Keyed by match
// and language, so a reload or a switch back finds the work.
export function codeFor(
  read: (key: string) => string | null,
  matchId: string,
  starters: Record<string, string>,
  language: string,
): string {
  return read(`battle:${matchId}:${language}`) ?? starters[language] ?? "";
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export function BattlePlay({
  matchId,
  statement,
  examples,
  starters,
  Editor = CodeEditor,
  now = Date.now,
}: Props) {
  const languages = Object.keys(starters);
  const [language, setLanguage] = useState(languages[0] ?? "python");
  const [code, setCode] = useState(() =>
    codeFor(stored, matchId, starters, language),
  );
  const [state, setState] = useState<BattleState>(BATTLE.start);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);
  const live = useRef<ReturnType<typeof runLive<BattleState>> | null>(null);

  useEffect(() => {
    const run = runLive({
      game: BATTLE,
      matchId,
      // A battle's match is made already: there's no queue.
      queue: () => Promise.reject(new Error("a battle has no queue")),
      open: async (id, on) => {
        // Handlers go on while the socket is still connecting: no frame is missed.
        const ws = await openMatch(id);
        ws.onmessage = (event) => {
          on.message(event.data);
        };
        ws.onclose = (event) => {
          on.close(event.reason);
        };
        return ws;
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now,
      onState: setState,
      onError: () => {
        setFailed(true);
      },
      fallback: () => Promise.resolve(null),
      onNoFallback: () => undefined,
      onOpponent: () => undefined,
    });
    live.current = run;
    const timer = setInterval(() => {
      tick((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
      run.stop();
      live.current = null;
    };
  }, [matchId, now]);

  // Every edit is stored as it's made (edit), so a switch only loads the other language.
  const pick = (next: string) => {
    setLanguage(next);
    setCode(codeFor(stored, matchId, starters, next));
  };
  const edit = (value: string) => {
    setCode(value);
    store(`battle:${matchId}:${language}`, value);
  };
  const send = (submit: boolean) => {
    if (live.current?.code(submit, language, code) === true)
      setState((s) => battleSent(s, submit));
  };

  return (
    <BattleView
      state={state}
      failed={failed}
      statement={statement}
      examples={examples}
      languages={languages}
      language={language}
      code={code}
      now={now()}
      Editor={Editor}
      onLanguage={pick}
      onCode={edit}
      onSend={send}
    />
  );
}

type ViewProps = {
  state: BattleState;
  failed: boolean;
  statement: string;
  examples: string[];
  languages: string[];
  language: string;
  code: string;
  now: number;
  Editor: ComponentType<CodeEditorProps>;
  onLanguage: (language: string) => void;
  onCode: (code: string) => void;
  onSend: (submit: boolean) => void;
};

// The screen for a state: pure, so it can be shown in tests as it is.
export function BattleView({
  state,
  failed,
  statement,
  examples,
  languages,
  language,
  code,
  now,
  Editor,
  onLanguage,
  onCode,
  onSend,
}: ViewProps) {
  if (failed)
    return (
      <p className="text-ink-muted">
        The connection to the battle was lost. Reload to rejoin: your best
        submission stands.
      </p>
    );
  if (state.phase === "cancelled")
    return <p className="text-ink-muted">This battle was cancelled.</p>;
  if (state.phase === "final") {
    const outcome = {
      won: "You won.",
      lost: "You lost.",
      draw: "A draw.",
    }[state.outcome];
    return (
      <section aria-label="Result" className="flex flex-col gap-2">
        <h2 className="text-title">{outcome}</h2>
        <ul>
          {Object.entries(state.totals).map(([player, points]) => (
            <li key={player}>
              {player === state.you ? "You" : "Opponent"}: {points} points
              {state.abandoned.includes(player) ? " (abandoned)" : ""}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const playing = state.phase === "playing" ? state : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section aria-label="Problem" className="flex flex-col gap-4">
        <pre className="whitespace-pre-wrap font-sans">{statement}</pre>
        <div>
          <h2 className="text-title">Examples</h2>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-sm">
            {examples.map((calls, i) => (
              <li key={i}>{calls}</li>
            ))}
          </ul>
        </div>
        {playing?.extension != null && (
          <div className="rounded-md border border-accent p-3">
            <h2 className="text-title">Extension</h2>
            <pre className="mt-1 whitespace-pre-wrap font-sans">
              {playing.extension.statement}
            </pre>
            <details className="mt-2">
              <summary>The new methods in {LANGUAGE_NAMES[language]}</summary>
              <pre className="mt-1 overflow-x-auto font-mono text-sm">
                {playing.extension.starters[language] ?? ""}
              </pre>
            </details>
          </div>
        )}
      </section>
      <section aria-label="Your code" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            Language
            <select
              value={language}
              onChange={(e) => {
                onLanguage(e.target.value);
              }}
              className="rounded-md border border-line px-2 py-1"
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_NAMES[l] ?? l}
                </option>
              ))}
            </select>
          </label>
          <span aria-label="Time left" className="font-mono">
            {playing === null ? "–" : clock(playing.endsAt - now)}
          </span>
          <span className="text-ink-muted">
            {playing === null
              ? "Connecting…"
              : Object.entries(playing.best)
                  .map(
                    ([player, points]) =>
                      `${player === playing.you ? "You" : "Opponent"} ${String(points)}`,
                  )
                  .join(" · ")}
          </span>
        </div>
        <Editor language={language} value={code} onChange={onCode} />
        <div className="flex gap-3">
          <button
            type="button"
            disabled={playing === null || playing.running}
            onClick={() => {
              onSend(false);
            }}
            className="rounded-md border border-line px-4 py-2 disabled:opacity-50"
          >
            {playing?.running === true ? "Running…" : "Run"}
          </button>
          <button
            type="button"
            disabled={playing === null || playing.submitting}
            onClick={() => {
              onSend(true);
            }}
            className="rounded-md bg-accent px-4 py-2 text-on-accent disabled:opacity-50"
          >
            {playing?.submitting === true ? "Submitting…" : "Submit"}
          </button>
        </div>
        {playing?.notice != null && (
          <p role="status" className="text-ink-muted">
            {playing.notice}
          </p>
        )}
        {playing?.ran != null && (
          <div aria-label="Run">
            <h2 className="text-title">Run: the visible tests</h2>
            <ul>
              {playing.ran.map((t, i) => (
                <li key={i}>
                  Test {i + 1}: {t.passed ? "passed" : "failed"}
                  {t.passed
                    ? ""
                    : t.verdict !== undefined && t.verdict !== "ok"
                      ? ` (${t.verdict.replace("_", " ")})`
                      : t.call !== undefined
                        ? ` at call ${String(t.call)}: ${t.reason ?? ""}`
                        : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {playing?.submitted != null && (
          <div aria-label="Submission">
            <h2 className="text-title">
              Submission: {playing.submitted.points} points
            </h2>
            <ul>
              {Object.entries(playing.submitted.layers).map(([layer, l]) => (
                <li key={layer}>
                  {LAYER_NAMES[layer] ?? layer}: {l.passed} of {l.total}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
