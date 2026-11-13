"use client";

import { useEffect, useState } from "react";
import type { BattleQuestion } from "../../../../server/ports";

// P5-W33 (§6.2, AI-1; Q-P5-13): "ask the interviewer" in an AI-league battle. The
// requirements are vague on purpose; the interviewer, a model answering from the
// problem's notes, fills them in. At most 10 questions; answers are labelled AI.
type Question = BattleQuestion;

// INTERVIEWER_QUESTIONS (server/ports.ts), which the route enforces; a value from that
// module would pull server code into this client one.
const LIMIT = 10;

export function Interviewer({
  matchId,
  initial,
}: {
  matchId: string;
  initial: Question[]; // read by the page, so a reload shows them at once
}) {
  const [asked, setAsked] = useState<Question[]>(initial);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const path = `/api/battle/${matchId}/questions`;

  const refresh = async () => {
    const res = await fetch(path);
    if (res.ok) setAsked((await res.json()) as Question[]);
  };

  // While an answer is pending, look again every 3 s.
  const pending = asked.some((q) => q.status === "pending");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      fetch(path)
        .then(async (res) => {
          if (res.ok) setAsked((await res.json()) as Question[]);
        })
        .catch((error: unknown) => {
          console.error("battle: questions not read", error);
        });
    }, 3000);
    return () => {
      clearInterval(timer);
    };
  }, [pending, path]);

  const ask = async () => {
    setNotice(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: draft }),
    });
    if (res.status === 429) setNotice("That was your 10th question.");
    else if (!res.ok) setNotice("The interviewer couldn't take that question.");
    else setDraft("");
    await refresh();
  };

  return (
    <InterviewerView
      asked={asked}
      draft={draft}
      notice={notice}
      onDraft={setDraft}
      onAsk={() => {
        void ask();
      }}
    />
  );
}

export function InterviewerView({
  asked,
  draft,
  notice,
  onDraft,
  onAsk,
}: {
  asked: Question[];
  draft: string;
  notice: string | null;
  onDraft: (text: string) => void;
  onAsk: () => void;
}) {
  const left = LIMIT - asked.length;
  return (
    <section aria-label="Ask the interviewer" className="flex flex-col gap-2">
      <h2 className="text-title">Ask the interviewer</h2>
      <p className="text-sm text-ink-muted">
        The requirements are open on purpose. Answers are written by AI from the
        interviewer&apos;s notes. {left} of {LIMIT} questions left.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {asked.map((q) => (
          <li key={q.id}>
            <p className="font-semibold">{q.question}</p>
            <p>
              {q.status === "pending" ? (
                <span className="text-ink-muted">Thinking…</span>
              ) : q.status === "unavailable" ? (
                <span className="text-ink-muted">
                  The interviewer couldn&apos;t answer that one.
                </span>
              ) : (
                <>
                  <span className="mr-1 rounded bg-well px-1 text-xs">AI</span>
                  {q.answer}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAsk();
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            maxLength={500}
            onChange={(e) => {
              onDraft(e.target.value);
            }}
            aria-label="Your question"
            className="min-w-0 flex-1 rounded-md border border-line px-2 py-1"
          />
          <button
            type="submit"
            disabled={draft.trim() === ""}
            className="rounded-md border border-line px-3 py-1 disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      )}
      {notice !== null && (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
