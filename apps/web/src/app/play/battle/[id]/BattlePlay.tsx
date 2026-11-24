"use client";

import {
  BATTLE,
  type BattleState,
  battleSent,
  runLive,
} from "@interval/game-client";
import {
  type ComponentType,
  Fragment,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { ClockIcon } from "../../../hld/Clock";
import { HEADER } from "../../../hld/Frame";
import { openMatch } from "../../live/join";
import { CodeEditor, type CodeEditorProps } from "./CodeEditor";
import { HintPanel } from "./Hints";
import { HINT_LEVELS } from "@interval/lld/hints";
import { Statement } from "./Statement";

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
  // ADR-0048: null while a practice page is starting its session.
  matchId: string | null;
  // The page's title block, for the frame's header.
  heading: ReactNode;
  // What kind of game this is, under the Tests heading on a desktop.
  about?: ReactNode;
  // §6.2 (Q-P5-13): an AI-mode battle's interviewer, at the foot of the problem column.
  interviewer?: ReactNode;
  // The interface's calls, one line each (the web design's "Interface").
  signatures: string[];
  statement: string;
  examples: string[];
  starters: Record<string, string>;
  // Q-WD-14: each player's name, by the id the game server knows them as, for the
  // opponents' pills.
  players?: Record<string, string>;
  // Q-WD-17: a battle's code as last autosaved on the server, per language.
  autosaved?: Record<string, string>;
  // Tests swap Monaco for a plain field.
  Editor?: ComponentType<CodeEditorProps>;
  now?: () => number;
  // ADR-0048 (Q-WD-28): LLD practice, whose page holds the session.
  practice?: PracticeSession;
};

// What a practice page gives the screen: the player's best so far, whether the problem
// has an extension, each language's saved code, how to save it, and what to do when the
// session ends (`played`: it got as far as the battle's start).
export type PracticeBestShown = {
  points: number;
  hidden: { passed: number; total: number };
};
export type PracticeSave = (
  language: string,
  code: string,
  base: number,
) => Promise<{ ok: true; version: number } | { ok: false; reason: string }>;
type PracticeSession = {
  best: PracticeBestShown | null;
  hasExtension: boolean;
  saved: Record<string, { code: string; version: number }>;
  save: PracticeSave;
  onEnded: (matchId: string, played: boolean) => void;
};

// Q-WD-17: a language's autosave: none yet, an edit waiting to go, one out, the last one
// in, or the last one failed (it waits for a Retry or the next edit).
type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "failed";

// ADR-0048, Q-WD-17: the autosave waits this long after the last edit.
const SAVE_AFTER_MS = 2_000;
const SAVE_REFUSED: Record<string, string> = {
  stale: "Saved in another tab: reload to get it.",
  "too-large": "Too much code to save.",
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

// Q-WD-17: this tab's copy of a battle's code in one language, kept on every edit, and
// whether the server has it yet. Keyed by match and language.
const LocalCopy = z.object({ code: z.string(), unsaved: z.boolean() });
type LocalCopy = z.infer<typeof LocalCopy>;
const localKey = (matchId: string, language: string) =>
  `battle:${matchId}:${language}`;

export function localCopy(
  read: (key: string) => string | null,
  matchId: string,
  language: string,
): LocalCopy | null {
  const raw = read(localKey(matchId, language));
  if (raw === null) return null;
  try {
    const parsed = LocalCopy.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // not this page's: as if none
  }
}

// Q-WD-17: a battle's code per language on load. The server's autosaved copy, unless
// this tab holds code it never got (a save failed, then a reload): that wins, and goes
// to the server again (`resend`). Then this tab's copy, then (by the caller) the
// starter. Unsaved local code is newer than anything this tab saved; another device's
// later save is the one thing it can overwrite.
export function restoreBattleCode(
  local: (language: string) => LocalCopy | null,
  autosaved: Record<string, string>,
  languages: string[],
): { code: Record<string, string>; resend: string[] } {
  const code: Record<string, string> = {};
  const resend: string[] = [];
  for (const l of languages) {
    const mine = local(l);
    const server = autosaved[l];
    if (mine?.unsaved === true) {
      code[l] = mine.code;
      resend.push(l);
    } else if (server !== undefined) code[l] = server;
    else if (mine !== null) code[l] = mine.code;
  }
  return { code, resend };
}

// A battle's code in one language: what `read` finds, or the starter. Keyed by match
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
  about,
  interviewer,
  signatures,
  statement,
  examples,
  starters,
  players = {},
  autosaved = {},
  Editor = CodeEditor,
  now = Date.now,
  practice,
}: Props) {
  const languages = Object.keys(starters);
  const [language, setLanguage] = useState(languages[0] ?? "python");
  // A practice player's code is saved on the server, not in this tab (ADR-0048): what
  // was saved, then each edit, per language, and the version each was saved at.
  const practiceCode = useRef<Record<string, string>>(
    Object.fromEntries(
      Object.entries(practice?.saved ?? {}).map(([l, s]) => [l, s.code]),
    ),
  );
  const versions = useRef<Record<string, number>>(
    Object.fromEntries(
      Object.entries(practice?.saved ?? {}).map(([l, s]) => [l, s.version]),
    ),
  );
  // Q-WD-17: a battle's code is autosaved on the server too: what was restored, then
  // each edit, per language, and how each language's last save went.
  const [restored] = useState(() =>
    practice === undefined && matchId !== null
      ? restoreBattleCode(
          (l) => localCopy(stored, matchId, l),
          autosaved,
          languages,
        )
      : { code: {}, resend: [] },
  );
  const battleCode = useRef<Record<string, string>>({ ...restored.code });
  const [autosaveStatus, setAutosaveStatus] = useState<
    Record<string, AutosaveStatus>
  >({});
  const statusOf = (l: string, status: AutosaveStatus) => {
    setAutosaveStatus((was) => ({ ...was, [l]: status }));
  };
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const read = (key: string): string | null => {
    const l = key.slice(key.lastIndexOf(":") + 1);
    if (practice === undefined)
      return (
        battleCode.current[l] ??
        localCopy(stored, matchId ?? "", l)?.code ??
        null
      );
    return practiceCode.current[l] ?? null;
  };
  const [code, setCode] = useState(() =>
    practice === undefined
      ? (restored.code[language] ?? starters[language] ?? "")
      : (practice.saved[language]?.code ?? starters[language] ?? ""),
  );
  const [state, setState] = useState<BattleState>(BATTLE.start);
  // Q-WD-17: a hint asked for with no open socket isn't sent: said, to try again.
  const [hintNotice, setHintNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);
  const live = useRef<ReturnType<typeof runLive<BattleState>> | null>(null);
  // P5-W31-S04b (§6.9, Q-P5-17): the code every 30 s while the battle is on, for review
  // of a fair-play flag; unchanged code adds nothing, so isn't sent again.
  const latest = useRef({ code, language, playing: false });
  useEffect(() => {
    latest.current = { code, language, playing: state.phase === "playing" };
  });
  const practicing = practice !== undefined;
  useEffect(() => {
    // Practice keeps no fair-play record (ADR-0048).
    if (practicing || matchId === null) return;
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
  }, [matchId, practicing]);

  // ADR-0048: a practice session that ended (its hour, or away past the grace), or that
  // can't be joined (it ended while the page was away), is replaced by the page.
  const ended = useRef(practice?.onEnded);
  useEffect(() => {
    ended.current = practice?.onEnded;
  });
  const played = useRef(false);
  // The match the state is from: for a moment after the page moves to a new session,
  // the state is still the old one's end.
  const stateOf = useRef<string | null>(null);
  useEffect(() => {
    if (matchId === null || stateOf.current !== matchId) return;
    if (state.phase === "playing") played.current = true;
    if (state.phase === "final" || state.phase === "cancelled")
      ended.current?.(matchId, played.current);
  }, [state.phase, matchId]);

  useEffect(() => {
    if (matchId === null) return;
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
      onState: (next) => {
        stateOf.current = matchId;
        setState(next);
      },
      onError: () => {
        if (ended.current === undefined) setFailed(true);
        else ended.current(matchId, played.current);
      },
      fallback: () => Promise.resolve(null),
      onNoFallback: () => undefined,
      onOpponent: () => undefined,
    });
    live.current = run;
    played.current = false;
    const timer = setInterval(() => {
      tick((n) => n + 1);
    }, 1000);
    if (practicing)
      return () => {
        clearInterval(timer);
        run.stop();
        live.current = null;
      };
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
    return () => {
      window.removeEventListener("blur", lost);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(timer);
      run.stop();
      live.current = null;
    };
  }, [matchId, now, practicing]);

  // Every edit is stored as it's made (edit), so a switch only loads the other language.
  const pick = (next: string) => {
    setLanguage(next);
    setCode(codeFor(read, matchId ?? "", starters, next));
  };
  // One save at a time per language, each over the version the last one made: two in
  // flight at once would refuse each other as stale.
  const saveChain = useRef<Record<string, Promise<void>>>({});
  const autosave = (save: PracticeSave, l: string, value: string) => {
    clearTimeout(saveTimers.current[l]);
    saveTimers.current[l] = setTimeout(() => {
      saveChain.current[l] = (saveChain.current[l] ?? Promise.resolve())
        .then(() => save(l, value, versions.current[l] ?? 0))
        .then((saved) => {
          if (saved.ok) {
            versions.current[l] = saved.version;
            setSaving(null);
          } else setSaving(SAVE_REFUSED[saved.reason] ?? "Couldn't save.");
        })
        .catch((error: unknown) => {
          console.error("practice: code not saved", error);
          setSaving("Couldn't save: trying again with your next edit.");
        });
    }, SAVE_AFTER_MS);
  };
  // Q-WD-17: one language's code to the server, after the ones before it.
  const sendCode = (l: string, value: string) => {
    if (matchId === null) return;
    statusOf(l, "saving");
    saveChain.current[l] = (saveChain.current[l] ?? Promise.resolve())
      .then(() =>
        fetch(`/api/battle/${matchId}/code`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language: l, code: value }),
        }),
      )
      .then((res) => {
        if (!res.ok) throw new Error(`refused: ${String(res.status)}`);
        // An edit since is still to go: its own save says how it went.
        if (battleCode.current[l] !== value) return;
        store(
          localKey(matchId, l),
          JSON.stringify({ code: value, unsaved: false }),
        );
        statusOf(l, "saved");
      })
      .catch((error: unknown) => {
        console.error("battle: code not autosaved", error);
        statusOf(l, "failed");
      });
  };
  // What this tab had and the server never got goes again at once.
  const resend = useRef(sendCode);
  useEffect(() => {
    resend.current = sendCode;
  });
  useEffect(() => {
    for (const l of restored.resend) resend.current(l, restored.code[l] ?? "");
  }, [restored]);
  const edit = (value: string) => {
    setCode(value);
    if (practice === undefined) {
      if (matchId === null) return;
      store(
        localKey(matchId, language),
        JSON.stringify({ code: value, unsaved: true }),
      );
      battleCode.current[language] = value;
      const l = language;
      // Not "Autosaved" while the edit waits to go.
      statusOf(l, "pending");
      clearTimeout(saveTimers.current[l]);
      saveTimers.current[l] = setTimeout(() => {
        sendCode(l, value);
      }, SAVE_AFTER_MS);
      return;
    }
    practiceCode.current[language] = value;
    autosave(practice.save, language, value);
  };
  const paste = (pasted: string, had: string[]) => {
    if (practicing) return;
    const extension = state.phase === "playing" ? state.extension : null;
    const chars = outsidePaste(pasted, [
      ...had,
      statement,
      ...Object.values(starters),
      ...Object.values(extension?.starters ?? {}),
      extension?.statement ?? "",
      ...languages
        .filter((l) => l !== language)
        .map((l) => codeFor(read, matchId ?? "", {}, l)),
    ]);
    if (chars !== null) live.current?.pasted(chars);
  };
  const send = (submit: boolean) => {
    if (live.current?.code(submit, language, code) === true)
      setState((s) => battleSent(s, submit));
  };
  // Ctrl or Cmd + Enter runs the visible tests, as in most code editors.
  const run = useRef(send);
  useEffect(() => {
    run.current = send;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        run.current(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <BattleView
      resultHref={
        matchId === null ? "/play/battle" : `/play/battle/${matchId}/result`
      }
      exitHref={
        practice === undefined ? "/play/battle" : "/play/battle/practice"
      }
      heading={heading}
      about={about}
      interviewer={interviewer}
      signatures={signatures}
      players={players}
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
      onHint={(level) => {
        setHintNotice(
          live.current?.hint(level) === true
            ? null
            : "Not connected: try again in a moment.",
        );
      }}
      hintNotice={hintNotice}
      {...(practice === undefined
        ? {
            autosave: {
              status: autosaveStatus[language] ?? "idle",
              onRetry: () => {
                sendCode(language, battleCode.current[language] ?? "");
              },
            },
          }
        : {})}
      {...(practice === undefined
        ? {}
        : {
            practice: {
              best: practice.best,
              canReveal: practice.hasExtension,
              onReveal: () => {
                live.current?.reveal();
              },
              saving,
            },
          })}
    />
  );
}

type ViewProps = {
  resultHref: string;
  // Where the header's × goes: the lobby, or the practice list.
  exitHref?: string;
  heading: ReactNode;
  about?: ReactNode;
  interviewer?: ReactNode;
  signatures: string[];
  players?: Record<string, string>;
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
  // Q-WD-17: the player opens a hint level (confirmed first in a battle), and what went
  // wrong asking for the last one.
  onHint?: (level: number) => void;
  hintNotice?: string | null;
  // Q-WD-17: how a battle's autosave went, and a way to send a failed one again.
  autosave?: { status: AutosaveStatus; onRetry: () => void };
  // ADR-0048: LLD practice: the player's best, the extension on request (`canReveal`:
  // the problem has one), and the autosave's trouble, if any.
  practice?:
    | {
        best: PracticeBestShown | null;
        canReveal: boolean;
        onReveal: () => void;
        saving: string | null;
      }
    | undefined;
};

// The screen for a state: pure, so it can be shown in tests as it is.
export function BattleView({
  resultHref,
  exitHref = "/play/battle",
  heading,
  about,
  interviewer,
  signatures,
  players = {},
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
  onHint = () => undefined,
  hintNotice = null,
  autosave,
  practice,
}: ViewProps) {
  const playing = state.phase === "playing" ? state : null;
  // Q-WD-17: the failing test's line the player jumped to, for the answer it came with.
  // Highlighted until their next edit or run: an edit, a language switch or a Run or
  // Submit sent (by button or keyboard, even one then refused) drops it, and the next
  // answer's failing test is another.
  const [jumped, setJumped] = useState<{
    line: number;
    failing: NonNullable<typeof playing>["failing"];
  } | null>(null);
  // The language last sent, set as a send starts: a failing line is in that code, so
  // the link shows only while it's the one in the editor.
  const sending = playing?.running === true || playing?.submitting === true;
  const [sent, setSent] = useState({ sending: false, language });
  if (sent.sending !== sending) {
    setSent({ sending, language: sending ? language : sent.language });
    if (sending) setJumped(null);
  }
  const jump =
    jumped !== null && playing !== null && jumped.failing === playing.failing
      ? jumped
      : null;
  const failing = playing?.failing ?? null;
  const best =
    practice === undefined
      ? null
      : practice.best === null
        ? "Not started"
        : `Your best: ${String(practice.best.points)} · hidden ${String(practice.best.hidden.passed)}/${String(practice.best.hidden.total)}`;
  const seats = playing === null ? 0 : Object.keys(playing.best).length;
  // The web design's frame (hld/Frame.tsx): the header across, then the problem, the
  // code and the tests side by side on a desktop.
  const header = (
    <header className={HEADER}>
      <a
        href={exitHref}
        aria-label={
          practice === undefined ? "Leave the battle" : "Leave practice"
        }
        className="hidden size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-hairline-strong lg:flex"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </a>
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
          {practice === undefined ? "LLD battle" : "LLD practice"}
          {seats === 2 && practice === undefined
            ? " · 1v1"
            : seats > 2 && practice === undefined
              ? ` · ${String(seats)} players`
              : ""}{" "}
          · {LANGUAGE_NAMES[language] ?? language}
        </p>
        {heading}
      </div>
      {best !== null ? (
        <span className="hidden h-[38px] items-center rounded-full bg-well px-3 text-sm text-ink-muted tabular-nums lg:flex">
          {best}
        </span>
      ) : playing === null ? null : (
        <>
          {pills(playing, players).map((b) => (
            <span
              key={b.player}
              title={b.title}
              className="hidden h-[38px] items-center gap-1.5 rounded-full bg-well px-3 text-sm text-ink-muted tabular-nums lg:flex"
            >
              {b.text}
              {b.hint !== undefined && <HintBadge {...b.hint} />}
            </span>
          ))}
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
  if (state.phase === "final" && practice !== undefined)
    return message(
      <p role="status" className="text-ink-muted">
        This session ended. Starting a new session…
      </p>,
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
        className="flex flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:min-w-0 lg:gap-1.5 lg:overflow-y-auto lg:p-5 lg:[scrollbar-gutter:stable]"
      >
        <h2 className="hidden text-[15px] font-semibold lg:block">Interface</h2>
        <ul className="hidden rounded-xl bg-well px-3 py-2.5 font-mono text-xs leading-[1.8] lg:block">
          {signatures.map((call, i) => (
            <Signature key={i} call={call} />
          ))}
        </ul>
        <h2 className="hidden text-[15px] font-semibold lg:mt-3.5 lg:block">
          Problem
        </h2>
        <div className="lg:text-ink-muted">
          <Statement markdown={statement} dropTitle />
        </div>
        <div className="lg:mt-3.5">
          <h2 className="text-title lg:text-[15px] lg:font-semibold lg:tracking-normal">
            Examples
          </h2>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-sm lg:mt-1.5 lg:gap-1.5 lg:text-xs">
            {examples.map((calls, i) => (
              <li
                key={i}
                className="overflow-x-auto rounded-xl bg-well px-3 py-2 leading-[1.8] whitespace-pre"
              >
                {calls}
              </li>
            ))}
          </ul>
        </div>
        {playing?.hints != null && (
          <HintPanel
            hints={playing.hints}
            onOpen={onHint}
            notice={hintNotice}
          />
        )}
        {practice?.canReveal === true &&
          playing !== null &&
          playing.extension === null && (
            <button
              type="button"
              onClick={practice.onReveal}
              className="w-fit rounded-full border-[1.5px] border-hairline-strong px-4 py-2 text-sm font-semibold lg:mt-3.5 lg:rounded-xl"
            >
              Reveal the extension
            </button>
          )}
        {playing?.extension != null && (
          <div className="rounded-2xl bg-(--system-design-tint) p-4 text-(--system-design-line) lg:mt-3.5 lg:rounded-2xl lg:border-0 lg:bg-(--system-design-tint) lg:text-[13px] lg:text-(--system-design-line)">
            <h2 className="text-title lg:text-[13px] lg:font-bold lg:tracking-normal">
              <span className="lg:hidden">Extension</span>
              <span className="hidden lg:inline">Extension round is live.</span>
            </h2>
            <div className="mt-1 lg:font-medium">
              <Statement
                markdown={playing.extension.statement}
                dropTitle={false}
              />
            </div>
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
        {interviewer}
      </section>
      <section
        aria-label="Your code"
        className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:min-w-0 lg:gap-0 lg:overflow-y-auto lg:border-x lg:border-hairline lg:p-5"
      >
        {/* On a desktop the card fills the column and the editor fills the card. */}
        <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:gap-0 lg:overflow-hidden lg:rounded-[18px] lg:border lg:border-hairline">
          <div className="flex flex-wrap items-center gap-3 lg:gap-2 lg:border-b lg:border-hairline lg:px-3.5 lg:py-2.5 lg:text-[13px]">
            <label className="flex items-center gap-2 lg:text-ink-muted">
              Language
              <select
                value={language}
                onChange={(e) => {
                  setJumped(null);
                  onLanguage(e.target.value);
                }}
                className="rounded-lg bg-well px-2 py-1 lg:rounded-lg lg:border-0 lg:bg-well lg:px-2.5 lg:font-mono lg:text-xs lg:font-semibold lg:text-ink"
              >
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAMES[l] ?? l}
                  </option>
                ))}
              </select>
            </label>
            {/* On a desktop the clock and the bests are in the header. */}
            {best === null ? (
              <>
                <span
                  role="timer"
                  aria-label="Time left"
                  className="font-mono lg:hidden"
                >
                  {playing === null ? "–" : clock(playing.endsAt - now)}
                </span>
                <span className="text-ink-muted lg:hidden">
                  {playing === null
                    ? "Connecting…"
                    : pills(playing, players).map((b, i) => (
                        <Fragment key={b.player}>
                          {i === 0 ? "" : ", "}
                          {b.text}
                          {b.hint !== undefined && (
                            <>
                              {" "}
                              <HintBadge {...b.hint} />
                            </>
                          )}
                        </Fragment>
                      ))}
                </span>
              </>
            ) : (
              <span className="text-ink-muted tabular-nums lg:hidden">
                {playing === null ? "Connecting…" : best}
              </span>
            )}
            {/* Where the code is kept: autosaved to the account in practice (ADR-0048),
                and on the server per language in a battle (Q-WD-17). */}
            <span
              role="status"
              aria-live="polite"
              className="text-ink-muted lg:ml-auto lg:text-[13px]"
            >
              {practice?.saving ??
                (autosave?.status === "saving" ||
                autosave?.status === "pending" ? (
                  "Saving…"
                ) : autosave?.status === "failed" ? (
                  <>
                    Not saved ·{" "}
                    <button
                      type="button"
                      onClick={autosave.onRetry}
                      className="font-semibold text-ink underline"
                    >
                      Retry
                    </button>
                  </>
                ) : autosave?.status === "saved" || playing !== null ? (
                  "Autosaved"
                ) : (
                  "Connecting…"
                ))}
            </span>
          </div>
          <div className="lg:relative lg:min-h-[420px] lg:flex-1">
            <Editor
              language={language}
              value={code}
              onChange={(value) => {
                setJumped(null);
                onCode(value);
              }}
              jump={jump}
              onPaste={onPaste}
            />
          </div>
        </div>
      </section>
      <section
        aria-label="Tests"
        className="flex flex-col gap-3 lg:col-start-3 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:min-w-0 lg:gap-0"
      >
        <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:gap-1 lg:overflow-y-auto lg:p-5 lg:[scrollbar-gutter:stable]">
          <h2 className="hidden text-[15px] font-semibold lg:mb-1 lg:block">
            Tests
          </h2>
          {about === undefined ? null : (
            <p className="hidden text-[13px] leading-snug text-ink-muted lg:mb-2 lg:block">
              {about}
            </p>
          )}
          {playing?.ran == null && playing?.submitted == null ? (
            <p className="hidden text-[13px] text-ink-muted lg:block">
              Run the visible tests, or submit for points.
            </p>
          ) : null}
          {practice === undefined &&
            playing !== null &&
            Object.keys(playing.best).length === 1 && (
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
          {failing !== null && (
            <div
              role="group"
              aria-label="Failing test"
              className="rounded-md bg-[color-mix(in_srgb,var(--wrong)_12%,var(--page))] px-3 py-2 text-wrong lg:order-first lg:mt-1 lg:rounded-xl lg:text-[13px]"
            >
              <p className="break-words">
                <span className="font-mono font-semibold">{failing.name}</span>
                {failing.message === undefined
                  ? " failed"
                  : ` · ${failing.message}`}
                {failing.line === undefined ||
                sent.language !== language ? null : (
                  <>
                    {" · "}
                    <button
                      type="button"
                      aria-label={`Jump to line ${String(failing.line)} of your code`}
                      onClick={() => {
                        if (failing.line !== undefined)
                          setJumped({ line: failing.line, failing });
                      }}
                      className="font-semibold underline underline-offset-2"
                    >
                      Jump to line {failing.line}
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
          {playing?.ran != null && (
            <div
              aria-label="Run"
              aria-live="polite"
              className="lg:order-2 lg:mt-3"
            >
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
            <div
              aria-label="Submission"
              aria-live="polite"
              className="lg:order-1"
            >
              <h2 className="text-title lg:text-sm lg:font-semibold lg:tracking-normal">
                Submission: {playing.submitted.points} points
              </h2>
              <ul>
                {Object.entries(playing.submitted.layers)
                  .sort(([a], [b]) => rank(a) - rank(b))
                  .map(([layer, l]) => (
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
        </div>
        {/* On a desktop, pinned under the scrolling results; on a phone, above them. */}
        <div className="order-first flex gap-3 lg:order-none lg:shrink-0 lg:gap-2 lg:border-t lg:border-hairline lg:px-5 lg:py-4">
          <button
            type="button"
            disabled={playing === null || playing.running}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title="Run the visible tests (Ctrl+Enter)"
            onClick={() => {
              onSend(false);
            }}
            className="rounded-full border-[1.5px] border-hairline-strong px-5 py-2.5 font-semibold disabled:opacity-50 lg:h-[46px] lg:flex-1 lg:rounded-xl lg:border-[1.5px] lg:py-0 lg:text-sm lg:font-semibold lg:border-hairline-strong"
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
            className="rounded-full bg-ink px-5 py-2.5 font-semibold text-page disabled:opacity-50 lg:h-[46px] lg:flex-1 lg:rounded-xl lg:bg-ink lg:py-0 lg:text-sm lg:font-semibold lg:text-page"
          >
            {playing?.submitting === true ? "Submitting…" : "Submit"}
          </button>
        </div>
      </section>
    </>
  );
}

// "Robin Sharma" and "robin_s" are RS; a one-word name gives its first two letters.
export function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter((w) => w !== "");
  const [first = "", second] = words;
  return (
    second === undefined
      ? first.slice(0, 2)
      : `${first[0] ?? ""}${second[0] ?? ""}`
  ).toUpperCase();
}

// Q-WD-14: your best in points; each opponent's best as tests passed, by their initials
// ("RS · 9 of 14 tests"), and compact in a room ("RS · 9/14"). An opponent the server
// sends no count for (one older than Q-WD-14) has no pill.
function pills(
  playing: Extract<BattleState, { phase: "playing" }>,
  players: Record<string, string>,
): {
  player: string;
  text: string;
  title?: string;
  hint?: { shown: string; label: string };
}[] {
  const seated = Object.keys(playing.best);
  const label = names(seated, playing.you);
  const room = seated.length > 2;
  return seated.flatMap((player) => {
    if (player === playing.you)
      return [
        {
          player,
          text: `Your best · ${String(playing.best[player] ?? 0)} points`,
        },
      ];
    const tests = playing.progress[player];
    if (tests === undefined) return [];
    const name = players[player];
    const who =
      name === undefined || initials(name) === ""
        ? (label[player] ?? player)
        : initials(name);
    const count = `${String(tests.passed)} of ${String(tests.total)} tests`;
    const full = name ?? label[player] ?? player;
    // Q-WD-17 (owner, 2026-11-24): the hint levels they've opened are public.
    const levels = [...(tests.hints ?? [])].sort((a, b) => a - b);
    return [
      {
        player,
        text: room
          ? `${who} · ${String(tests.passed)}/${String(tests.total)}`
          : `${who} · ${count}`,
        title: `${full}: ${count}`,
        ...(levels.length === 0
          ? {}
          : {
              hint: {
                shown: `${levels.length === 1 ? "Hint" : "Hints"} ${levels.join(", ")}`,
                label: `${full} used hints: ${levels
                  .map((l) => (HINT_LEVELS[l - 1] ?? "").toLowerCase())
                  .join(", ")}`,
              },
            }),
      },
    ];
  });
}

// Q-WD-17: an opponent's hints, as a badge on their pill; its words for a screen reader.
function HintBadge({ shown, label }: { shown: string; label: string }) {
  return (
    <span className="rounded-full bg-(--system-design-tint) px-2 py-0.5 text-xs font-semibold text-(--system-design-line)">
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// The layers in the order they're played; one this screen doesn't know goes last.
const LAYER_ORDER = Object.keys(LAYER_NAMES);
const rank = (layer: string) => {
  const i = LAYER_ORDER.indexOf(layer);
  return i === -1 ? LAYER_ORDER.length : i;
};

// A call on one line, or, too long for the column, broken only after its commas with
// the rest hanging under the name.
function Signature({ call }: { call: string }) {
  const parts = call.split(", ");
  return (
    <li className="indent-[-2ch] pl-[2ch]">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i === 0 ? null : " "}
          <span className="whitespace-pre">
            {part}
            {i < parts.length - 1 ? "," : ""}
          </span>
        </Fragment>
      ))}
    </li>
  );
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
