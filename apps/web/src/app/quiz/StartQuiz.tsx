import type { ReactNode } from "react";
import type { Chip } from "../../server/chips";
import { startQuizAction } from "./actions";

// The test-yourself mark (wireframes: a lightning bolt beside "Test 60s").
export const ZAP = "M13 2L4 14h7l-1 8 9-12h-7z";

// Starts Test 60s on a section, or (momentId null) an article (Q-P2-14, P2-W9-S02).
// Only shown where `Quizzes.offered` says a live question exists; `back` is where a
// sprint that can't start (its questions just went) returns to.
export function StartQuiz({
  itemId,
  momentId,
  chip,
  back,
  className,
  label,
  children,
}: {
  itemId: string;
  momentId: string | null;
  chip: Chip;
  back: string;
  className: string;
  // The button's accessible name when its content is only an icon.
  label?: string;
  children: ReactNode;
}) {
  return (
    <form action={startQuizAction}>
      <input type="hidden" name="itemId" value={itemId} />
      {momentId === null ? null : (
        <input type="hidden" name="momentId" value={momentId} />
      )}
      <input type="hidden" name="chip" value={chip} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        aria-label={label}
        title={label}
        className={`cursor-pointer ${className}`}
      >
        {children}
      </button>
    </form>
  );
}
