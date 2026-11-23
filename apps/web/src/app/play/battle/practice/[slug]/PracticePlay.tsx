"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BattlePlay, type PracticeBestShown } from "../../[id]/BattlePlay";
import { saveCode, startSession } from "./actions";

// ADR-0048 (Q-WD-28): a practice problem's session on the game server. The page starts
// one (or goes back to the open one), and when it ends (its hour, or away past the
// grace) starts the next without a word; the code stays, autosaved. A session that
// can't even start twice running is said, not retried forever.
const REFUSED: Record<string, string> = {
  limited: "That's a lot of sessions this hour. Try again later.",
  unavailable: "Practice isn't available right now.",
};

export function PracticePlay({
  slug,
  best,
  hasExtension,
  saved,
  ...screen
}: {
  slug: string;
  heading: ReactNode;
  signatures: string[];
  statement: string;
  examples: string[];
  starters: Record<string, string>;
  best: PracticeBestShown | null;
  hasExtension: boolean;
  saved: Record<string, { code: string; version: number }>;
}) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const handled = useRef(new Set<string>());
  const unplayed = useRef(false);

  const start = useCallback(
    (ended: string | null) => {
      startSession(slug, ended)
        .then((started) => {
          if (started.ok) setMatchId(started.matchId);
          else
            setProblem(
              REFUSED[started.reason] ?? "Couldn't start practice. Reload.",
            );
        })
        .catch((error: unknown) => {
          console.error("practice: session not started", error);
          setProblem("Couldn't start practice. Reload to try again.");
        });
    },
    [slug],
  );
  useEffect(() => {
    start(null);
  }, [start]);

  const onEnded = useCallback(
    (ended: string, played: boolean) => {
      if (handled.current.has(ended)) return;
      handled.current.add(ended);
      if (!played && unplayed.current) {
        setProblem("Couldn't join a practice session. Reload to try again.");
        return;
      }
      unplayed.current = !played;
      start(ended);
    },
    [start],
  );

  if (problem !== null)
    return (
      <p role="alert" className="text-ink-muted lg:col-span-3 lg:p-5">
        {problem}
      </p>
    );
  return (
    <BattlePlay
      matchId={matchId}
      {...screen}
      practice={{
        best,
        hasExtension,
        saved,
        save: (language, code, base) => saveCode(slug, language, code, base),
        onEnded,
      }}
    />
  );
}
