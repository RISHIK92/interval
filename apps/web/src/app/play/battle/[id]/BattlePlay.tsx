"use client";

import {
  BATTLE,
  type BattleState,
  battleSent,
  runLive,
} from "@interval/game-client";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ClockIcon } from "../../../hld/Clock";
import { HEADER } from "../../../hld/Frame";
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
  // The page's title block, for the frame's header.
  heading: ReactNode;
  // The interface's calls, one line each (the web design's "Interface").
  signatures: string[];
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

// P5-W31-S04a (§6.9, Q-P5-17): a paste this long that wasn't already there is a
// fair-play signal (the game server checks the length again). "There" is the editor
// without the paste, and what the player already had: this page's own text (the
// statement and starters) and their code in the other languages.
const PASTE_AT = 200;
const SNAPSHOT_EVERY_MS = 30_000;

export function outsidePaste(pasted: string, known: string[]): number | null {
  const text = pasted.trim();
  if (text.length < PASTE_AT || known.some((k) => k.includes(text)))
    return null;
  return text.length;
}

// P5-W32: you, the opponent in a 1v1, and numbered opponents in a room (C-03).
export function names(
  players: string[],
  you: string | null,
): Record<string, string> {
  const others = players.filter((p) => p !== you);
  return Object.fromEntries(
    players.map((p) => [
      p,
      p === you
        ? "You"
        : others.length === 1
          ? "Opponent"
          : `Opponent ${String(others.indexOf(p) + 1)}`,
    ]),
  );
}

// Q-P5-19: alone, a casual player meets the reference pace: when a strong solver
// typically passes each layer.
const PACE =
  "Reference pace: the visible tests by 10:00, the hidden ones by 25:00, the extension by 40:00.";

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

export function BattlePlay({
  matchId,
  heading,
  signatures,
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
  // P5-W31-S04b (§6.9, Q-P5-17): the code every 30 s while the battle is on, for review
  // of a fair-play flag; unchanged code adds nothing, so isn't sent again.
  const latest = useRef({ code, language, playing: false });
  useEffect(() => {
    latest.current = { code, language, playing: state.phase === "playing" };
  });
  useEffect(() => {
    let sent: string | null = null;
    const timer = setInterval(() => {
      const { code, language, playing } = latest.current;
      const snapshot = JSON.stringify({ language, code });
      if (!playing || snapshot === sent) return;
      fetch(`/api/battle/${matchId}/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: snapshot,
      })
        .then((res) => {
          // Sent only once stored: a refused one goes again next time.
          if (res.ok) sent = snapshot;
          else console.error("battle: snapshot refused", res.status);
        })
        .catch((error: unknown) => {
          console.error("battle: snapshot not sent", error);
        });
    }, SNAPSHOT_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [matchId]);

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
    // P5-W31-S04a (§6.9): another tab or window, as blur or a hidden page, and back; the
    // game server times it.
    const lost = () => {
      run.focusLost();
    };
    const back = () => {
      run.focusBack();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") run.focusLost();
      else run.focusBack();
    };
    window.addEventListener("blur", lost);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      tick((n) => n + 1);
    }, 1000);
    return () => {
      window.removeEventListener("blur", lost);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
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
  const paste = (pasted: string, had: string[]) => {
    const extension = state.phase === "playing" ? state.extension : null;
    const chars = outsidePaste(pasted, [
      ...had,
      statement,
      ...Object.values(starters),
      ...Object.values(extension?.starters ?? {}),
      extension?.statement ?? "",
      ...languages
        .filter((l) => l !== language)
        .map((l) => codeFor(stored, matchId, {}, l)),
    ]);
    if (chars !== null) live.current?.pasted(chars);
  };
  const send = (submit: boolean) => {
    if (live.current?.code(submit, language, code) === true)
      setState((s) => battleSent(s, submit));
  };

  return (
    <BattleView
      resultHref={`/play/battle/${matchId}/result`}
      heading={heading}
      signatures={signatures}
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
      onPaste={paste}
      onSend={send}
    />
  );
}

type ViewProps = {
  resultHref: string;
  heading: ReactNode;
  signatures: string[];
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
  onPaste: (pasted: string, had: string[]) => void;
  onSend: (submit: boolean) => void;
};

// The screen for a state: pure, so it can be shown in tests as it is.
export function BattleView({
  resultHref,
  heading,
  signatures,
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
  onPaste,
  onSend,
}: ViewProps) {
  const playing = state.phase === "playing" ? state : null;
  const seats = playing === null ? 0 : Object.keys(playing.best).length;
  // The web design's frame (hld/Frame.tsx): the header across, then the problem, the
  // code and the tests side by side on a desktop.
  const header = (
    <header className={HEADER}>
      <span
        className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-(--distributed-systems-tint) text-(--distributed-systems-right) lg:flex"
        aria-hidden="true"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
        </svg>
      </span>
      <div className="lg:min-w-[200px] lg:flex-1">
        <p className="hidden text-[13px] text-ink-muted lg:block">
          LLD battle
          {seats === 2
            ? " · 1v1"
            : seats > 2
              ? ` · ${String(seats)} players`
              : ""}{" "}
          · {LANGUAGE_NAMES[language] ?? language}
        </p>
        {heading}
      </div>
      {playing === null ? null : (
        <>
          <span className="hidden h-[38px] items-center rounded-full bg-well px-3 text-sm text-ink-muted tabular-nums lg:flex">
            {bests(playing)}
          </span>
          <span
            role="timer"
            aria-label="Time left"
            className="hidden h-[38px] items-center gap-2 rounded-full bg-ink px-3.5 text-[17px] font-bold text-page tabular-nums lg:flex"
          >
            <ClockIcon />
            {clock(playing.endsAt - now)}
          </span>
        </>
      )}
    </header>
  );
  const message = (body: ReactNode) => (
    <>
      {header}
      <div className="lg:col-span-3 lg:row-start-2 lg:p-5">{body}</div>
    </>
  );
  if (failed)
    return message(
      <p className="text-ink-muted">
        The connection to the battle was lost. Reload to rejoin: your best
        submission stands.
      </p>,
    );
  if (state.phase === "cancelled")
    return message(
      <p className="text-ink-muted">This battle was cancelled.</p>,
    );
  if (state.phase === "final") {
    const players = Object.keys(state.totals);
    const label = names(players, state.you);
    const place = state.you === null ? undefined : state.places[state.you];
    const outcome =
      players.length === 1
        ? "Finished."
        : players.length > 2 && place !== undefined
          ? `You placed ${String(place)} of ${String(players.length)}.`
          : { won: "You won.", lost: "You lost.", draw: "A draw." }[
              state.outcome
            ];
    return message(
      <section aria-label="Result" className="flex flex-col gap-2">
        <h2 className="text-title">{outcome}</h2>
        <ul>
          {players.map((player) => (
            <li key={player}>
              {label[player]}: {state.totals[player]} points
              {state.abandoned.includes(player) ? " (abandoned)" : ""}
            </li>
          ))}
        </ul>
        {/* P5-W35: the standings, replays, the AI review and a dispute. */}
        <a
          href={resultHref}
          className="underline lg:flex lg:h-12 lg:w-fit lg:items-center lg:rounded-xl lg:bg-ink lg:px-5 lg:font-semibold lg:text-page lg:no-underline"
        >
          See the results
        </a>
      </section>,
    );
  }
  return (
    <>
      {header}
      <section
        aria-label="Problem"
        className="flex flex-col gap-4 lg:col-start-1 lg:row-start-2 lg:min-w-0 lg:gap-1.5 lg:p-5"
      >
        <h2 className="hidden text-[15px] font-semibold lg:block">Interface</h2>
        <pre className="hidden overflow-x-auto rounded-xl bg-well px-3 py-2.5 font-mono text-xs leading-[1.8] lg:block">
          {signatures.join("\n")}
        </pre>
        <h2 className="hidden text-[15px] font-semibold lg:mt-3.5 lg:block">
          Problem
        </h2>
        <pre className="whitespace-pre-wrap font-sans lg:text-sm lg:text-ink-muted">
          {statement}
        </pre>
        <div className="lg:mt-3.5">
          <h2 className="text-title lg:text-[15px] lg:font-semibold lg:tracking-normal">
            Examples
          </h2>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-sm lg:mt-1.5 lg:gap-1.5 lg:text-xs">
            {examples.map((calls, i) => (
              <li
                key={i}
                className="lg:overflow-x-auto lg:rounded-xl lg:bg-well lg:px-3 lg:py-2"
              >
                {calls}
              </li>
            ))}
          </ul>
        </div>
        {playing?.extension != null && (
          <div className="rounded-md border border-accent p-3 lg:mt-3.5 lg:rounded-2xl lg:border-0 lg:bg-(--system-design-tint) lg:text-[13px] lg:text-(--system-design-line)">
            <h2 className="text-title lg:text-[13px] lg:font-bold lg:tracking-normal">
              <span className="lg:hidden">Extension</span>
              <span className="hidden lg:inline">Extension round is live.</span>
            </h2>
            <pre className="mt-1 whitespace-pre-wrap font-sans lg:font-medium">
              {playing.extension.statement}
            </pre>
            <details className="mt-2">
              <summary className="lg:font-semibold">
                The new methods in {LANGUAGE_NAMES[language]}
              </summary>
              <pre className="mt-1 overflow-x-auto font-mono text-sm lg:text-xs">
                {playing.extension.starters[language] ?? ""}
              </pre>
            </details>
          </div>
        )}
      </section>
      <section
        aria-label="Your code"
        className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:min-w-0 lg:gap-0 lg:border-x lg:border-hairline lg:p-5"
      >
        <div className="flex flex-col gap-3 lg:gap-0 lg:overflow-hidden lg:rounded-[18px] lg:border lg:border-hairline">
          <div className="flex flex-wrap items-center gap-3 lg:gap-2 lg:border-b lg:border-hairline lg:px-3.5 lg:py-2.5 lg:text-[13px]">
            <label className="flex items-center gap-2 lg:text-ink-muted">
              Language
              <select
                value={language}
                onChange={(e) => {
                  onLanguage(e.target.value);
                }}
                className="rounded-md border border-line px-2 py-1 lg:rounded-lg lg:border-0 lg:bg-well lg:px-2.5 lg:font-mono lg:text-xs lg:font-semibold lg:text-ink"
              >
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAMES[l] ?? l}
                  </option>
                ))}
              </select>
            </label>
            {/* On a desktop the clock and the bests are in the header. */}
            <span
              role="timer"
              aria-label="Time left"
              className="font-mono lg:hidden"
            >
              {playing === null ? "–" : clock(playing.endsAt - now)}
            </span>
            <span className="text-ink-muted lg:hidden">
              {playing === null ? "Connecting…" : bests(playing)}
            </span>
            {playing === null ? (
              <span className="hidden text-ink-muted lg:ml-auto lg:inline">
                Connecting…
              </span>
            ) : null}
          </div>
          <Editor
            language={language}
            value={code}
            onChange={onCode}
            onPaste={onPaste}
          />
        </div>
      </section>
      <section
        aria-label="Tests"
        className="flex flex-col gap-3 lg:col-start-3 lg:row-span-2 lg:row-start-2 lg:min-w-0 lg:gap-1 lg:p-5"
      >
        <h2 className="hidden text-[15px] font-semibold lg:mb-1 lg:block">
          Tests
        </h2>
        {playing?.ran == null && playing?.submitted == null ? (
          <p className="hidden text-[13px] text-ink-muted lg:block">
            Run the visible tests, or submit for points.
          </p>
        ) : null}
        <div className="flex gap-3 lg:order-last lg:mt-auto lg:gap-2 lg:pt-4">
          <button
            type="button"
            disabled={playing === null || playing.running}
            onClick={() => {
              onSend(false);
            }}
            className="rounded-md border border-line px-4 py-2 disabled:opacity-50 lg:h-[46px] lg:flex-1 lg:rounded-xl lg:border-[1.5px] lg:py-0 lg:text-sm lg:font-semibold lg:border-hairline-strong"
          >
            {playing?.running === true ? (
              "Running…"
            ) : (
              <>
                Run<span className="hidden lg:inline"> tests</span>
              </>
            )}
          </button>
          <button
            type="button"
            disabled={playing === null || playing.submitting}
            onClick={() => {
              onSend(true);
            }}
            className="rounded-md bg-accent px-4 py-2 text-on-accent disabled:opacity-50 lg:h-[46px] lg:flex-1 lg:rounded-xl lg:bg-ink lg:py-0 lg:text-sm lg:font-semibold lg:text-page"
          >
            {playing?.submitting === true ? "Submitting…" : "Submit"}
          </button>
        </div>
        {playing !== null && Object.keys(playing.best).length === 1 && (
          <p className="text-ink-muted lg:order-3 lg:mt-3 lg:text-[13px]">
            {PACE}
          </p>
        )}
        {playing?.notice != null && (
          <p
            role="status"
            className="text-ink-muted lg:order-3 lg:mt-2 lg:rounded-xl lg:bg-well lg:px-3 lg:py-2.5 lg:text-[13px]"
          >
            {playing.notice}
          </p>
        )}
        {playing?.ran != null && (
          <div aria-label="Run" className="lg:order-2 lg:mt-3">
            <h2 className="text-title lg:text-sm lg:font-semibold lg:tracking-normal">
              Run: the visible tests
            </h2>
            <ul className="lg:mt-1 lg:flex lg:flex-col lg:gap-1.5 lg:text-[13px]">
              {playing.ran.map((t, i) => (
                <li
                  key={i}
                  className={
                    t.passed
                      ? "lg:text-go-text"
                      : "lg:rounded-xl lg:bg-[color-mix(in_srgb,var(--wrong)_12%,var(--page))] lg:px-3 lg:py-2 lg:text-wrong"
                  }
                >
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
          <div aria-label="Submission" className="lg:order-1">
            <h2 className="text-title lg:text-sm lg:font-semibold lg:tracking-normal">
              Submission: {playing.submitted.points} points
            </h2>
            <ul>
              {Object.entries(playing.submitted.layers).map(([layer, l]) => (
                <li
                  key={layer}
                  className="lg:flex lg:items-center lg:justify-between lg:border-b lg:border-hairline lg:py-2.5 lg:text-sm lg:last:border-b-0"
                >
                  <span>
                    {LAYER_NAMES[layer] ?? layer}
                    <span className="lg:hidden">: </span>
                  </span>
                  <span className="lg:flex lg:items-center lg:gap-1.5 lg:font-semibold lg:tabular-nums">
                    {l.passed} of {l.total}
                    <LayerIcon passed={l.passed} total={l.total} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

function bests(playing: Extract<BattleState, { phase: "playing" }>): string {
  return Object.entries(playing.best)
    .map(
      ([player, points]) =>
        `${names(Object.keys(playing.best), playing.you)[player] ?? player} ${String(points)}`,
    )
    .join(" · ");
}

// The web design's marks for a layer: all passing, some, none.
function LayerIcon({ passed, total }: { passed: number; total: number }) {
  const shared = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    role: "img",
    className: "hidden lg:block",
  };
  if (passed === total)
    return (
      <svg {...shared} aria-label="All passing" color="var(--go)">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    );
  if (passed > 0)
    return (
      <svg
        {...shared}
        aria-label="Some failing"
        color="var(--system-design-line)"
      >
        <path d="M12 3 2 20h20zM12 9v5M12 17h.01" />
      </svg>
    );
  return (
    <svg {...shared} aria-label="Failing" color="var(--wrong)">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}
