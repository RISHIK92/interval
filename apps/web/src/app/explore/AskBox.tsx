"use client";

import { useEffect, useRef, useState } from "react";
import {
  ASK_MAX_CHARS,
  ASK_MAX_FOLLOW_UPS,
  type AskChip,
  type AskThread,
} from "../../server/ports";
import { outHref } from "../../server/outbound";

// ADR-0046: Explore's one box. Enter searches the library (it works without scripts);
// Ask sends the question to the worker, which answers from the user's catalogue, and
// this asks again every few seconds until it has. The chips only prefill the box. No
// voice input (Q-WD-22).

export type AskView = Omit<AskThread, "askedAt">;

const POLL_MS = 2_000;
// About two minutes: a lost job (no worker running) stops being asked about.
const MAX_POLLS = 60;

// The design's prompt chips, each a template for the box.
const CHIPS: { chip: AskChip; label: string; prefill: string }[] = [
  { chip: "compare", label: "Compare two things", prefill: "Compare " },
  {
    chip: "explain_new",
    label: "Explain like I’m new",
    prefill: "Explain like I’m new: ",
  },
  {
    chip: "interview_drill",
    label: "Interview drill",
    prefill: "Interview drill: ",
  },
  {
    chip: "my_stack",
    label: "Use my stack as the example",
    prefill: "Use my stack as the example: ",
  },
];

const REFUSED: Record<string, string> = {
  daily_limit: "You’ve asked all of today’s questions. Ask again tomorrow.",
  user_budget: "Ask has used today’s AI budget. Try again tomorrow.",
  global_budget: "Ask has used today’s AI budget. Try again tomorrow.",
  thread_full: `A thread takes ${String(ASK_MAX_FOLLOW_UPS)} follow-ups. Ask a new question instead.`,
};

const OUTCOME: Record<string, string> = {
  over_budget: "Ask has used today’s AI budget. Try again tomorrow.",
  unavailable: "Ask couldn’t answer this one. Try again later.",
};

// "[m12]" or "[m12, c3]": a sentence's cited passages, shown as the numbers of their
// source chips.
const CITE = /\s*\[([a-z]\d+(?:\s*,\s*[a-z]\d+)*)\]/g;

function AnswerText({ text, passages }: { text: string; passages: string[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITE)) {
    parts.push(text.slice(last, match.index));
    const numbers = (match[1] ?? "")
      .split(",")
      .map((p) => passages.indexOf(p.trim()) + 1)
      .filter((n) => n > 0);
    if (numbers.length > 0)
      parts.push(
        <sup key={match.index} className="ml-0.5 text-xs text-ink-muted">
          {numbers.join(",")}
        </sup>,
      );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <p className="text-base leading-[1.55]">{parts}</p>;
}

function Answer({
  thread,
  onFollowUp,
  onDelete,
}: {
  thread: AskView;
  onFollowUp: () => void;
  onDelete: () => void;
}) {
  const answer = thread.answer;
  const passages = answer?.citations.map((c) => c.passage) ?? [];
  return (
    // AI-1: AI text sits in a dashed box with its tag.
    <section
      aria-label="Your last question"
      aria-live="polite"
      className="flex flex-col gap-2.5 rounded-[22px] border-[1.5px] border-dashed border-hairline-strong px-5 py-[18px]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-muted">
          You asked · “{thread.text}”
        </span>
        <span className="rounded-full bg-well px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
          AI
        </span>
      </div>
      {answer === null ? (
        <p className="text-ink-muted">Looking through your library…</p>
      ) : answer.outcome === "answered" && answer.text !== null ? (
        <AnswerText text={answer.text} passages={passages} />
      ) : answer.outcome === "nothing_found" ? (
        <p>
          Nothing in your library covers this yet.{" "}
          <a
            href={`/explore?q=${encodeURIComponent(thread.text)}`}
            className="font-semibold text-select"
          >
            See what search finds
          </a>
        </p>
      ) : (
        <p>{OUTCOME[answer.outcome]}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {answer?.citations.map((c, i) =>
          c.kind === "reading" ? (
            <a
              key={c.passage}
              href={outHref({
                itemId: c.itemId,
                ...(c.momentId === null ? {} : { momentId: c.momentId }),
                from: "explore",
                target: "section",
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full pr-2.5 pl-2 text-[13px] font-semibold"
              style={{
                background: `var(--${c.topic ?? "review"}-tint)`,
              }}
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[3px]"
                style={{ background: `var(--${c.topic ?? "review"}-left)` }}
              />
              <sup className="text-[11px]">{i + 1}</sup>
              {c.label}
            </a>
          ) : (
            <span
              key={c.passage}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full pr-2.5 pl-2 text-[13px] font-semibold"
              style={{ background: `var(--${c.topic ?? "review"}-tint)` }}
            >
              <sup className="text-[11px]">{i + 1}</sup>
              {c.label}
            </span>
          ),
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onDelete}
          className="h-10 rounded-full px-3 text-sm font-semibold text-ink-soft hover:bg-well"
        >
          Delete
        </button>
        {answer?.outcome === "answered" && thread.depth < ASK_MAX_FOLLOW_UPS ? (
          <button
            type="button"
            onClick={onFollowUp}
            className="h-10 rounded-full border-[1.5px] border-hairline-strong px-3.5 text-sm font-semibold"
          >
            Ask a follow-up
          </button>
        ) : null}
        {answer?.citations.some(
          (c) => c.kind === "reading" && c.momentId !== null,
        ) === true ? (
          <a
            href={`/explore/session?question=${thread.id}`}
            className="flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-page"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[11px]">
              <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
            </svg>
            Make it a 4-min session
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function AskBox({
  canAsk,
  query,
  initial,
}: {
  canAsk: boolean;
  query: string;
  initial: AskView | null;
}) {
  const [text, setText] = useState(query);
  const [chip, setChip] = useState<AskChip | null>(null);
  const [thread, setThread] = useState<AskView | null>(initial);
  const [followUpOf, setFollowUpOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // LOAD-5: one key per question as composed; a retry after a failure reuses it.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [polls, setPolls] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pending = thread !== null && thread.answer === null;

  // The design's "/" key: to the box from anywhere but a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.key !== "/" ||
        target?.closest("input, textarea, select, [contenteditable]")
      )
        return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (polls >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      fetch(`/api/explore/ask/${thread.id}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          setThread((await r.json()) as AskView);
        })
        .catch((e: unknown) => {
          console.error("explore: answer not read", e);
          setError("Couldn’t check on the answer. Reload to try again.");
        });
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pending, thread, polls]);

  const ask = async () => {
    const question = text.trim();
    if (question === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/explore/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: question,
          chip,
          idempotencyKey: key,
          followUpOf,
        }),
      });
      if (r.status === 429 || r.status === 409) {
        const { refused } = (await r.json()) as { refused: string };
        setError(REFUSED[refused] ?? "Couldn’t ask that. Try again.");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const { id } = (await r.json()) as { id: string };
      setThread({
        id,
        text: question,
        chip,
        depth:
          thread !== null && followUpOf === thread.id ? thread.depth + 1 : 0,
        answer: null,
      });
      setPolls(0);
      setText("");
      setChip(null);
      setFollowUpOf(null);
      setKey(crypto.randomUUID());
    } catch (e: unknown) {
      console.error("explore: question not asked", e);
      setError("Couldn’t ask that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (thread === null) return;
    const r = await fetch(`/api/explore/ask/${thread.id}`, {
      method: "DELETE",
    });
    if (!r.ok && r.status !== 404) {
      setError("Couldn’t delete that question. Try again.");
      return;
    }
    setThread(null);
    setFollowUpOf(null);
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2.5">
        <form
          role="search"
          action="/explore"
          method="get"
          className="flex h-[60px] items-center gap-3 rounded-full bg-well pr-2 pl-5"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 shrink-0 text-select"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          </svg>
          <input
            ref={input}
            type="search"
            name="q"
            aria-label={canAsk ? "Ask or search" : "Search"}
            placeholder={
              canAsk
                ? "Ask anything, or search your library"
                : "Search your library"
            }
            maxLength={ASK_MAX_CHARS}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setKey(crypto.randomUUID()); // a changed question is a new one
              // A chip holds only while its template starts the box.
              const held = CHIPS.find((c) => c.chip === chip);
              if (
                held !== undefined &&
                !e.target.value.startsWith(held.prefill)
              )
                setChip(null);
            }}
            className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-muted"
          />
          <kbd
            aria-hidden="true"
            className="hidden h-6 items-center rounded-md border-[1.5px] border-b-[3px] border-hairline-strong px-[7px] font-mono text-[11px] font-semibold text-ink-soft lg:inline-flex"
          >
            /
          </kbd>
          {canAsk ? (
            <>
              {/* Enter searches: the form's first submit button. */}
              <button type="submit" className="sr-only">
                Search
              </button>
              <button
                type="button"
                onClick={() => void ask()}
                disabled={busy || text.trim() === ""}
                className="h-11 rounded-full bg-ink px-5 text-[15px] font-semibold text-page disabled:opacity-50"
              >
                {followUpOf === null ? "Ask" : "Ask follow-up"}
              </button>
            </>
          ) : (
            <button
              type="submit"
              className="h-11 rounded-full bg-ink px-5 text-[15px] font-semibold text-page"
            >
              Search
            </button>
          )}
        </form>
        {canAsk ? (
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button
                key={c.chip}
                type="button"
                aria-pressed={chip === c.chip}
                onClick={() => {
                  setChip(c.chip);
                  setText(c.prefill);
                  setKey(crypto.randomUUID()); // a changed question is a new one
                  input.current?.focus();
                }}
                className={`inline-flex h-9 items-center rounded-full border-[1.5px] px-3.5 text-sm font-medium ${chip === c.chip ? "border-ink text-ink" : "border-hairline text-ink-soft"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        {pending && polls >= MAX_POLLS ? (
          <p role="status" className="text-sm text-ink-muted">
            The answer is taking a while. Reload to check again.
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-ink-muted">
            {error}
          </p>
        )}
      </div>
      {thread === null ? null : (
        <Answer
          thread={thread}
          onFollowUp={() => {
            setFollowUpOf(thread.id);
            setKey(crypto.randomUUID()); // a changed question is a new one
            input.current?.focus();
          }}
          onDelete={() => void remove()}
        />
      )}
    </div>
  );
}
